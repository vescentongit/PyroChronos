"""B2 boundary tests: fake only HTTP; exercise real disk and ingest orchestration."""
import asyncio
import hashlib
import io
import json
import logging
import tempfile
import traceback
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

import httpx

from firms import SafeFailure
from ingest import FirmsTransport, IngestService, validate_csv
from raw_storage import FileRawStorage

SECRET = "sentinel-FIRMS-PRIVATE-key-do-not-emit"
HEADER = b"latitude,longitude,acq_date,acq_time,satellite,confidence,version,frp\n"
CSV = HEADER + b"-2.56,113.91,2026-11-09,0045,N,nominal,2.0NRT,7.2\n"
REQUEST_ID = "c146ffdb-734b-47f1-a3c0-3bff7ec79af1"


class MemoryBatches:
    """Boundary double; actual PostgreSQL adapter is tested against B1 migrations."""
    def __init__(self):
        self.rows = {}
        self.fail = None

    async def claim(self, record):
        if self.fail == "claim":
            raise RuntimeError(SECRET)
        if record["id"] in self.rows:
            return False, dict(self.rows[record["id"]])
        self.rows[record["id"]] = dict(record)
        return True, dict(record)

    async def update(self, batch_id, fields):
        if self.fail == fields["status"]:
            raise RuntimeError(SECRET)
        self.rows[batch_id].update(fields)


class IngestTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.assertIsNotNone(IngestService, "B2 ingest service has not been implemented")
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.repo = MemoryBatches()
        self.storage = FileRawStorage(Path(self.tmp.name))
        self.calls = []
        self.response = lambda req: httpx.Response(200, content=CSV, headers={"Content-Type": "text/csv"})
        self.client = httpx.AsyncClient(transport=httpx.MockTransport(self.respond), follow_redirects=False)
        self.addAsyncCleanup(self.client.aclose)
        self.transport = FirmsTransport(client=self.client)
        self.logs = []
        self.service = IngestService(self.repo, self.storage, self.transport, log=self.logs.append)

    async def respond(self, request):
        self.calls.append(request)
        response = self.response(request)
        return await response if hasattr(response, "__await__") else response

    async def run_ingest(self, **kwargs):
        with patch.dict("os.environ", {"FIRMS_MAP_KEY": SECRET}):
            return await self.service.ingest("kalteng", "VIIRS_NOAA20_NRT", date(2026, 11, 9),
                                             request_id=REQUEST_ID, **kwargs)

    async def test_valid_payload_is_stored_before_validation_with_exact_checksum(self):
        def parser(payload, source, region):
            stored = list(Path(self.tmp.name).rglob("*.csv"))
            self.assertEqual(stored[0].read_bytes(), payload)
            return validate_csv(payload, source, region)
        self.service.validator = parser
        result = await self.run_ingest()
        self.assertEqual(result["status"], "VALID")
        record = self.repo.rows[REQUEST_ID]
        self.assertEqual(record["checksumSha256"], hashlib.sha256(CSV).hexdigest())
        self.assertEqual(record["payloadBytes"], len(CSV))
        self.assertEqual(record["rowCount"], 1)
        self.assertIsNone(record["productVersion"])

    async def test_header_only_is_empty_but_zero_bytes_and_html_are_rejected_and_preserved(self):
        for index, (body, status) in enumerate([(HEADER, "EMPTY"), (b"", "REJECTED"),
                                                (b"<html>upstream error</html>", "REJECTED")]):
            self.response = lambda req, body=body: httpx.Response(200, content=body)
            result = await self.run_ingest_alias(index)
            self.assertEqual(result["status"], status)
            record = self.repo.rows[result["batchId"]]
            self.assertEqual((Path(self.tmp.name) / record["payloadRef"]).read_bytes(), body)

    async def run_ingest_alias(self, index):
        with patch.dict("os.environ", {"FIRMS_MAP_KEY": SECRET}):
            return await self.service.ingest("kalteng", "VIIRS_NOAA20_NRT", date(2026, 11, 9),
                                             request_id=f"c146ffdb-734b-47f1-a3c0-{index:012d}")

    async def test_allowlists_reject_non_strings_prototype_keys_and_arbitrary_sources(self):
        for region, source, code in [
            ("__proto__", "MODIS_NRT", "REGION_NOT_ALLOWED"),
            ({"id": "kalteng"}, "MODIS_NRT", "REGION_NOT_ALLOWED"),
            ("kalteng", "constructor", "SOURCE_NOT_ALLOWED"),
            ("kalteng", ["VIIRS_NOAA20_NRT"], "SOURCE_NOT_ALLOWED"),
        ]:
            result = await self.service.ingest(region, source, date(2026, 11, 9))
            self.assertEqual(result["errorCode"], code)
        self.assertEqual(self.calls, [])
        self.assertEqual(self.repo.rows, {})

    async def test_request_is_https_official_host_and_region_bbox_only(self):
        await self.run_ingest()
        url = self.calls[0].url
        self.assertEqual(url.scheme, "https")
        self.assertEqual(url.host, "firms.modaps.eosdis.nasa.gov")
        self.assertIn("/113,-3.6,115,-1.5/1/2026-11-09", str(url))

    async def test_same_request_id_is_idempotent_but_new_fetch_appends(self):
        first = await self.run_ingest()
        self.assertEqual(await self.run_ingest(), first)
        self.assertEqual(len(self.calls), 1)
        await self.run_ingest_alias(1)
        self.assertEqual(len(self.repo.rows), 2)
        self.assertEqual(len(self.calls), 2)

    async def test_reused_request_id_with_different_scope_is_rejected(self):
        await self.run_ingest()
        with patch.dict("os.environ", {"FIRMS_MAP_KEY": SECRET}):
            result = await self.service.ingest("papua", "VIIRS_NOAA20_NRT", date(2026, 11, 9),
                                               request_id=REQUEST_ID)
        self.assertEqual(result["errorCode"], "IDEMPOTENCY_CONFLICT")
        self.assertEqual(len(self.calls), 1)

    async def test_in_flight_id_is_not_fetched_twice(self):
        entered, release = asyncio.Event(), asyncio.Event()
        async def delayed(req):
            entered.set()
            await release.wait()
            return httpx.Response(200, content=CSV)
        self.response = delayed
        first = asyncio.create_task(self.run_ingest())
        await entered.wait()
        second = await self.run_ingest()
        self.assertEqual(second["errorCode"], "IN_PROGRESS")
        release.set()
        self.assertEqual((await first)["status"], "VALID")
        self.assertEqual(len(self.calls), 1)

    async def test_missing_key_and_bad_windows_never_fetch(self):
        with patch.dict("os.environ", {"FIRMS_MAP_KEY": ""}):
            result = await self.service.ingest("kalteng", "MODIS_NRT", date(2026, 11, 9))
        self.assertEqual(result["errorCode"], "CONFIG_MISSING")
        for days in [0, 6, True, "2"]:
            self.assertEqual((await self.run_ingest(days=days))["errorCode"], "INVALID_REQUEST")
        self.assertEqual(self.calls, [])

    async def test_redirect_and_http_errors_have_safe_retry_flags(self):
        for index, (status, code, retryable) in enumerate([
            (302, "UPSTREAM_REDIRECT", False), (429, "UPSTREAM_RATE_LIMITED", True),
            (401, "UPSTREAM_DENIED", False), (403, "UPSTREAM_DENIED", False),
            (503, "UPSTREAM_UNAVAILABLE", True),
        ]):
            self.response = lambda req, status=status: httpx.Response(status, headers={
                "Location": f"https://evil.invalid/{SECRET}"}, content=SECRET.encode())
            result = await self.run_ingest_alias(index)
            self.assertEqual(result["errorCode"], code)
            self.assertEqual(result["retryable"], retryable)
        self.assertEqual(len(self.calls), 5)
        self.assertFalse(list(Path(self.tmp.name).rglob("*.csv")))

    async def test_global_deadline_includes_body_stream_and_cumulative_delay(self):
        class Slow(httpx.AsyncByteStream):
            async def __aiter__(self):
                for _ in range(20):
                    await asyncio.sleep(0.01)
                    yield b"x"
        self.transport.timeout_seconds = 0.035
        self.response = lambda req: httpx.Response(200, stream=Slow())
        result = await asyncio.wait_for(self.run_ingest(), 0.2)
        self.assertEqual(result["errorCode"], "UPSTREAM_TIMEOUT")
        self.assertTrue(result["retryable"])

    async def test_oversize_and_truncated_responses_never_reach_parser(self):
        self.transport.max_bytes = 64
        self.response = lambda req: httpx.Response(200, content=CSV)
        self.assertEqual((await self.run_ingest())["errorCode"], "PAYLOAD_TOO_LARGE")
        self.response = lambda req: httpx.Response(200, content=HEADER, headers={"Content-Length": "999"})
        self.transport.max_bytes = 1024
        self.assertEqual((await self.run_ingest_alias(1))["errorCode"], "INVALID_RESPONSE")

    async def test_invalid_csv_schema_and_rows_are_preserved_and_rejected(self):
        for index, body in enumerate([
            CSV.replace(b"longitude", b"changed_column"), HEADER + b'"unterminated',
            HEADER + b"-2.56,113.91,2026-11-09\n", CSV.replace(b"113.91", b"999"),
            CSV.replace(b"0045", b"2460"), CSV.replace(b"7.2", b"nan"),
            CSV.replace(b"-2.56", b"-8.56"), CSV.replace(b"2026-11-09", b"2026-1-9"),
        ]):
            self.response = lambda req, body=body: httpx.Response(200, content=body)
            result = await self.run_ingest_alias(index)
            self.assertEqual(result["status"], "REJECTED")
            self.assertEqual(result["errorCode"], "INVALID_RESPONSE")
            self.assertTrue((Path(self.tmp.name) / self.repo.rows[result["batchId"]]["payloadRef"]).exists())

    async def test_modis_confidence_and_satellite_fields_are_accepted_without_viirs_coercion(self):
        body = CSV.replace(b",N,nominal,", b",Terra,80,")
        self.response = lambda req: httpx.Response(200, content=body)
        with patch.dict("os.environ", {"FIRMS_MAP_KEY": SECRET}):
            result = await self.service.ingest("kalteng", "MODIS_NRT", date(2026, 11, 9), request_id=REQUEST_ID)
        self.assertEqual(result["status"], "VALID")

    async def test_storage_and_database_failures_do_not_claim_success(self):
        self.repo.fail = "claim"
        self.assertEqual((await self.run_ingest())["errorCode"], "DATABASE_FAILED")
        self.repo.fail = "FETCHED"
        self.assertEqual((await self.run_ingest())["errorCode"], "DATABASE_FAILED")
        self.repo.fail = None
        with patch.object(self.storage, "put", side_effect=RuntimeError(SECRET)):
            self.assertEqual((await self.run_ingest_alias(2))["errorCode"], "STORAGE_FAILED")

    async def test_secret_sentinel_never_appears_in_results_logs_or_library_logs(self):
        capture = io.StringIO()
        handler = logging.StreamHandler(capture)
        root = logging.getLogger()
        root.addHandler(handler)
        previous = root.level
        root.setLevel(logging.DEBUG)
        self.addCleanup(root.removeHandler, handler)
        self.addCleanup(root.setLevel, previous)
        def error(req):
            raise httpx.ReadError(f"failed {req.url} {SECRET}")
        self.response = error
        results = [await self.run_ingest()]
        self.response = lambda req: httpx.Response(200, content=HEADER + SECRET.encode())
        results.append(await self.run_ingest_alias(1))
        self.assertNotIn(SECRET, json.dumps(results) + json.dumps(self.logs) + capture.getvalue())
        allowed = {"batchId", "regionId", "sourceId", "status", "duration", "errorCode"}
        for record in self.logs:
            self.assertLessEqual(set(record), allowed)
        self.assertEqual(results[1]["errorCode"], "INVALID_RESPONSE")

    async def test_storage_is_write_once_and_rejects_path_traversal(self):
        first = await self.storage.put(REQUEST_ID, CSV)
        self.assertEqual(await self.storage.put(REQUEST_ID, CSV), first)
        with self.assertRaises(SafeFailure) as caught:
            await self.storage.put(REQUEST_ID, b"replacement")
        self.assertNotIn(SECRET, str(caught.exception))
        with self.assertRaises(SafeFailure):
            await self.storage.put("../../escape", CSV)
        self.assertEqual((Path(self.tmp.name) / first["payloadRef"]).read_bytes(), CSV)

    async def test_transport_exception_chain_and_traceback_never_include_secret(self):
        def broken(req):
            raise httpx.ConnectError(f"network failed: {req.url} {SECRET}")
        self.response = broken
        from firms import CONFIG, SafeFailure
        stack, context = None, None
        try:
            await self.transport.fetch(SECRET, "MODIS_NRT", CONFIG["regions"]["kalteng"], date(2026, 11, 9), 1)
        except SafeFailure as error:
            # Capture before unittest can clear the exception's traceback.
            stack, context = "".join(traceback.format_exception(error)), error.__context__
        self.assertIsNotNone(stack)
        self.assertIn("Traceback", stack)
        self.assertNotIn(SECRET, stack)
        self.assertIsNone(context)

    async def test_invalid_request_id_objects_do_not_escape_as_exceptions(self):
        class Unsafe:
            def __str__(self):
                raise RuntimeError(SECRET)
        with patch.dict("os.environ", {"FIRMS_MAP_KEY": SECRET}):
            result = await self.service.ingest("kalteng", "MODIS_NRT", date(2026, 11, 9), request_id=Unsafe())
        self.assertEqual(result["errorCode"], "INVALID_REQUEST")

    async def test_parser_version_is_recorded_for_injected_validator(self):
        service = IngestService(self.repo, self.storage, self.transport,
                                validator=lambda payload, source, region: 1)
        service.validator_version = "nathan-parser-v2"
        with patch.dict("os.environ", {"FIRMS_MAP_KEY": SECRET}):
            await service.ingest("kalteng", "VIIRS_NOAA20_NRT", date(2026, 11, 9), request_id=REQUEST_ID)
        self.assertEqual(self.repo.rows[REQUEST_ID]["validatorVersion"], "nathan-parser-v2")

    async def test_untrusted_failure_code_cannot_become_a_secret_response_or_log(self):
        from firms import SafeFailure
        with patch.object(self.transport, "fetch", side_effect=SafeFailure(SECRET, True)):
            result = await self.run_ingest()
        self.assertNotIn(SECRET, json.dumps(result) + json.dumps(self.logs))

    async def test_metadata_write_failure_best_effort_records_a_terminal_failure(self):
        self.repo.fail = "FETCHED"
        self.assertEqual((await self.run_ingest())["errorCode"], "DATABASE_FAILED")
        self.repo.fail = None
        replay = await self.run_ingest()
        self.assertEqual(replay["status"], "FAILED")
        self.assertEqual(replay["errorCode"], "DATABASE_FAILED")
        self.assertEqual(len(self.calls), 1)


if __name__ == "__main__":
    unittest.main()
