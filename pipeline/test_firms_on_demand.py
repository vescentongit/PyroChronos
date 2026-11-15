"""Request-scoped coverage, bounded fetch planning and original-evidence integrity."""

import copy
import json
import unittest
from unittest.mock import patch

from area_counts import count_source
from area_query import Polygon
from firms_on_demand import download, prepare
from reference_baseline import window_covered
from research_worker import analyze, produce

GEOMETRY = {"type": "Polygon", "coordinates": [[[113, -3], [114, -3], [113, -2], [113, -3]]]}
AVAILABLE = b"data_id,min_date,max_date\nMODIS_SP,2000-11-01,2025-12-31\nVIIRS_SNPP_SP,2012-01-20,2025-12-31\n"
MODIS = "latitude,longitude,brightness,acq_date,acq_time,satellite,confidence,version,frp,daynight\n"
VIIRS = MODIS.replace("brightness", "bright_ti4")


def data(geometry=GEOMETRY, start="2019-01-01", end="2019-01-02"):
    return {"area": {"geometry": geometry, "name": "Test", "id": "area", "geometryHash": "server-hash"},
            "period": {"start": start, "end": end}, "comparisonPeriod": None,
            "baseline": {"windowYears": 10},
            "dataset": {"sources": ["MODIS_SP", "VIIRS_SNPP_SP"], "producerVersion": "research-harmonized-1"}}


class OnDemandTests(unittest.TestCase):
    def test_expired_fetch_budget_is_timeout_without_starting_a_request(self):
        with patch("firms_on_demand.download") as fetch:
            with self.assertRaisesRegex(ValueError, "^TIMEOUT$"):
                prepare(data(), "test-key", deadline_seconds=0)
            fetch.assert_not_called()

    def test_deadline_while_waiting_for_parallel_requests_is_timeout(self):
        import time

        def slow_fetch(url, timeout):
            if "data_availability" in url:
                return AVAILABLE
            time.sleep(0.03)
            return MODIS.encode() if "/MODIS_SP/" in url else VIIRS.encode()

        with self.assertRaisesRegex(ValueError, "^TIMEOUT$"):
            prepare(data(), "test-key", fetch=slow_fetch, deadline_seconds=0.01)

    def test_transport_failures_return_safe_actionable_codes(self):
        import urllib.error
        errors = [(urllib.error.URLError(OSError("private-url-with-key")), "NETWORK_ERROR"),
                  (TimeoutError("private-url-with-key"), "TIMEOUT"),
                  (urllib.error.URLError(TimeoutError("private-url-with-key")), "TIMEOUT"),
                  (urllib.error.HTTPError("private-url-with-key", 403, "denied", {}, None), "UPSTREAM_DENIED"),
                  (urllib.error.HTTPError("private-url-with-key", 429, "limited", {}, None), "RATE_LIMITED")]
        for error, code in errors:
            with self.subTest(code=code), patch("urllib.request.OpenerDirector.open", side_effect=error):
                with self.assertRaisesRegex(ValueError, f"^{code}$"):
                    download("https://example.test/private-key", 1)

    def test_http_failure_closes_the_response_stream(self):
        import io
        import urllib.error

        body = io.BytesIO(b"private response")
        failure = urllib.error.HTTPError("https://example.test/private-key", 403, "denied", {}, body)
        with patch("urllib.request.OpenerDirector.open", side_effect=failure):
            with self.assertRaisesRegex(ValueError, "^UPSTREAM_DENIED$"):
                download("https://example.test/private-key", 1)
        self.assertTrue(body.closed)

    def fetch(self, url, timeout):
        if "data_availability" in url:
            return AVAILABLE
        return (MODIS if "/MODIS_SP/" in url else VIIRS).encode()

    def test_empty_success_is_zero_and_missing_source_is_null(self):
        selected = data(start="2012-01-19", end="2012-01-21")
        snapshot = prepare(selected, "test-key", fetch=self.fetch)
        result = produce(snapshot, {"id": "run", "workspaceId": "workspace", "input": {
            **selected, "dataset": {**selected["dataset"], "fingerprint": snapshot.fingerprint()}}})
        days = result["days"][0]["days"]
        self.assertEqual(days[0]["metric"]["rawCountsBySource"], {"MODIS_SP": 0, "VIIRS_SNPP_SP": None})
        self.assertEqual(days[1]["metric"]["rawCountsBySource"], {"MODIS_SP": 0, "VIIRS_SNPP_SP": 0})
        self.assertEqual(result["result"]["primary"]["metric"]["status"], "partial")
        self.assertEqual(snapshot.source_coverage("VIIRS_SNPP_SP")[2012]["first_observed"], None)
        from datetime import date
        self.assertFalse(window_covered(snapshot.source_coverage("VIIRS_SNPP_SP"), date(2012, 1, 19), date(2012, 1, 21)))
        self.assertTrue(window_covered(snapshot.source_coverage("VIIRS_SNPP_SP"), date(2012, 1, 20), date(2012, 1, 21)))

    def test_polygon_filter_preserves_evidence_and_deduplicates(self):
        def fetch(url, timeout):
            if "/MODIS_SP/" in url:
                inside = "-2.9,113.100001,300,2019-01-01,1230,T,90,6.1,2,D\n"
                outside = "-2.1,113.9,300,2019-01-01,1230,T,90,6.1,2,D\n"
                return (MODIS + inside + inside + outside).encode()
            return self.fetch(url, timeout)
        snapshot = prepare(data(), "test-key", fetch=fetch)
        self.assertEqual(len(snapshot.records), 1)
        self.assertEqual(snapshot.records[0]["lon"], 113.100001)
        self.assertEqual(count_source(snapshot, "MODIS_SP", Polygon(GEOMETRY), "2019-01-01", "2019-01-02")["months"]["2019-01"]["count"], 1)
        self.assertNotIn("test-key", json.dumps(snapshot.provenance))

    def test_failed_or_malformed_response_is_never_zero(self):
        for body in (b"", b"Invalid MAP_KEY", (MODIS + "bad,row\n").encode()):
            with self.subTest(body=body):
                def fetch(url, timeout, body=body):
                    return AVAILABLE if "data_availability" in url else body
                with self.assertRaises(ValueError):
                    prepare(data(), "test-key", fetch=fetch)
        with self.assertRaises(ValueError):
            prepare(data(), "test-key", fetch=lambda *args: b"data_id,min_date,max_date\n")

    def test_conflicting_duplicate_fails_closed(self):
        def fetch(url, timeout):
            if "/MODIS_SP/" in url:
                return (MODIS + "-2.9,113.1,300,2019-01-01,1230,T,90,6.1,2,D\n"
                        + "-2.9,113.1,300,2019-01-01,1230,T,90,6.1,3,D\n").encode()
            return self.fetch(url, timeout)
        with self.assertRaises(ValueError):
            prepare(data(), "test-key", fetch=fetch)

    def test_fingerprint_binds_raw_responses_even_empty_and_references(self):
        first = prepare(data(), "test-key", fetch=self.fetch)
        second = prepare(data(), "another-key", fetch=self.fetch)
        self.assertEqual(first.fingerprint(), second.fingerprint())
        def changed(url, timeout):
            return self.fetch(url, timeout) + (b"\n" if "data_availability" not in url else b"")
        self.assertNotEqual(first.fingerprint(), prepare(data(), "test-key", fetch=changed).fingerprint())

    def test_antimeridian_uses_two_bboxes_with_bounded_windows(self):
        geometry = {"type": "Polygon", "coordinates": [[[179, -2], [-179, -2], [-179, -1], [179, -1], [179, -2]]]}
        snapshot = prepare(data(geometry, end="2019-01-11"), "test-key", fetch=self.fetch)
        self.assertEqual(len(snapshot.receipts), 12)  # 3 windows x 2 pieces x 2 sources
        self.assertEqual({item["bbox"][0] for item in snapshot.receipts}, {-180.0, 179.0})
        with self.assertRaisesRegex(ValueError, "CAPACITY_LIMIT"):
            prepare(data(end="2019-02-01"), "test-key", fetch=self.fetch)

    def test_references_only_for_supported_model_and_requested_years(self):
        calls = []
        def fetch(url, timeout):
            calls.append(url)
            return self.fetch(url, timeout)
        selected = data({"type": "Polygon", "coordinates": [[[-61, -10], [-60.9, -10], [-60.9, -9.9], [-61, -10]]]})
        selected["baseline"]["windowYears"] = 4
        snapshot = prepare(selected, "test-key", fetch=fetch)
        refs = [item for item in snapshot.receipts if item["start"][:4] != "2019"]
        self.assertEqual({item["start"][:4] for item in refs}, {"2015", "2016", "2017", "2018"})
        self.assertEqual({item["source"] for item in refs}, {"VIIRS_SNPP_SP"})
        selected["includeBaseline"] = False
        snapshot = prepare(selected, "test-key", fetch=fetch)
        self.assertEqual(len(snapshot.receipts), 2)

    def test_one_call_handshake_pins_the_actual_snapshot(self):
        selected = data()
        snapshot = prepare(selected, "test-key", fetch=self.fetch)
        with patch("firms_on_demand.prepare", return_value=snapshot):
            answer = analyze(None, {"id": "run", "workspaceId": "workspace", "input": copy.deepcopy(selected)})
        self.assertEqual(answer["fingerprint"], snapshot.fingerprint())
        self.assertEqual(answer["bundle"]["manifest"]["snapshot"], snapshot.provenance)
        self.assertEqual(answer["bundle"]["result"]["dataVersion"], "firms-area-" + snapshot.fingerprint()[7:])


if __name__ == "__main__":
    unittest.main()
