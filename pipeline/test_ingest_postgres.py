"""Execute production repository SQL on PostgreSQL, not a repository mock."""
import asyncio
import json
import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path
from unittest.mock import patch

import httpx

from ingest import IngestService
from raw_batches import PostgresRawBatches
from raw_storage import FileRawStorage
from test_ingest import CSV, HEADER, REQUEST_ID, SECRET


class BridgeCursor:
    def __init__(self, rows):
        self.rows = rows

    async def fetchone(self):
        if not self.rows:
            return None
        row = self.rows[0]
        for field in ("requestedStart", "requestedEnd", "fetchStartedAt", "fetchedAt", "completedAt"):
            if row.get(field):
                row[field] = datetime.fromisoformat(row[field])
        return row


class BridgeConnection:
    async def start(self):
        self.process = await asyncio.create_subprocess_exec(
            "node", str(Path(__file__).resolve().parents[1] / "tests/helpers/postgres-bridge.mjs"),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        line = await asyncio.wait_for(self.process.stdout.readline(), 15)
        if line != b'{"ready":true}\n' and line != b'{"ready":true}\r\n':
            raise AssertionError("PostgreSQL test bridge did not initialize")

    async def execute(self, sql, params=()):
        # psycopg placeholders -> PGlite placeholders at the test-only wire edge.
        parts = sql.split("%s")
        sql = "".join(part + (f"${i + 1}" if i < len(parts) - 1 else "") for i, part in enumerate(parts))
        self.process.stdin.write((json.dumps({"sql": sql, "params": params}, default=str) + "\n").encode())
        await self.process.stdin.drain()
        message = json.loads(await self.process.stdout.readline())
        if "errorCode" in message:
            raise RuntimeError(message["errorCode"])
        return BridgeCursor(message["rows"])

    async def close(self):
        self.process.stdin.close()
        await asyncio.wait_for(self.process.wait(), 5)


class PostgresIngestTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.assertIsNotNone(PostgresRawBatches, "PostgreSQL raw batch adapter is missing")
        self.connection = BridgeConnection()
        await self.connection.start()
        self.addAsyncCleanup(self.connection.close)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.client = httpx.AsyncClient(transport=httpx.MockTransport(lambda req: httpx.Response(200, content=CSV)))
        self.addAsyncCleanup(self.client.aclose)

    async def test_service_writes_valid_batch_and_retry_does_not_duplicate_history(self):
        from firms import FirmsTransport
        repo = PostgresRawBatches(self.connection)
        service = IngestService(repo, FileRawStorage(self.tmp.name), FirmsTransport(self.client))
        with patch.dict("os.environ", {"FIRMS_MAP_KEY": SECRET}):
            first = await service.ingest("kalteng", "VIIRS_NOAA20_NRT", date(2026, 11, 9), request_id=REQUEST_ID)
            second = await service.ingest("kalteng", "VIIRS_NOAA20_NRT", date(2026, 11, 9), request_id=REQUEST_ID)
        self.assertEqual(first, second)
        self.assertEqual(first["status"], "VALID")
        cursor = await self.connection.execute('SELECT count(*)::int AS n FROM "RawBatch"')
        self.assertEqual((await cursor.fetchone())["n"], 1)
        cursor = await self.connection.execute('SELECT * FROM "RawBatch"')
        row = await cursor.fetchone()
        self.assertEqual(row["rowCount"], 1)
        self.assertEqual((Path(self.tmp.name) / row["payloadRef"]).read_bytes(), CSV)
        self.assertNotIn(SECRET, json.dumps(row, default=str))

    async def test_empty_rejected_and_failed_lifecycles_obey_B1_constraints(self):
        from firms import FirmsTransport
        for index, (body, http_status, status) in enumerate([
            (HEADER, 200, "EMPTY"), (b"<html>error</html>", 200, "REJECTED"), (b"", 429, "FAILED")
        ]):
            async with httpx.AsyncClient(transport=httpx.MockTransport(
                lambda req, body=body, http_status=http_status: httpx.Response(http_status, content=body)
            )) as client:
                service = IngestService(PostgresRawBatches(self.connection), FileRawStorage(self.tmp.name), FirmsTransport(client))
                with patch.dict("os.environ", {"FIRMS_MAP_KEY": SECRET}):
                    result = await service.ingest("papua", "MODIS_NRT", date(2026, 11, 9),
                        request_id=f"c146ffdb-734b-47f1-a3c0-{index:012d}")
                self.assertEqual(result["status"], status)

