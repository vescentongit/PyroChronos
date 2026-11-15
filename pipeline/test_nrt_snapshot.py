import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import nrt_snapshot as snap

HEADER = "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight\n"


def row(lat, lon, day, confidence="n", time="1145"):
    return f"{lat},{lon},340.0,0.5,0.5,{day},{time},N,VIIRS,{confidence},2.0NRT,300.0,10.0,D\n"


def write_batch(root, area, start, text, tamper=False):
    folder = Path(root) / "VIIRS_SNPP_NRT" / area
    folder.mkdir(parents=True, exist_ok=True)
    body = text.encode()
    digest = hashlib.sha256(body).hexdigest()
    path = folder / f"{start}_2d_{digest[:12]}.csv"
    path.write_bytes(body + (b"x" if tamper else b""))
    entry = {"source": "VIIRS_SNPP_NRT", "area": area, "bbox": [0, 0, 10, 10], "start_date": start, "day_range": 2, "sha256": digest, "path": path.relative_to(root).as_posix(), "fetched_at": "2026-11-14T00:00:00Z", "counts": {"rows": text.count(chr(10)) - 1}}
    with (folder / "manifest.jsonl").open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry) + chr(10))


class SnapshotTests(unittest.TestCase):
    def test_daily_counts_apply_quality_policy_and_dedupe(self):
        with tempfile.TemporaryDirectory() as root:
            text = HEADER + row(1, 1, "2026-10-01") + row(1, 1, "2026-10-01") + row(2, 2, "2026-10-01", "l") + row(3, 3, "2026-10-02", "h")
            write_batch(root, "box", "2026-10-01", text)
            area = snap.freeze(root, "VIIRS_SNPP_NRT")["areas"]["box"]
        self.assertEqual(area["dailyCounts"], {"2026-10-01": 1, "2026-10-02": 1})
        self.assertEqual((area["firstDay"], area["lastDay"]), ("2026-10-01", "2026-10-02"))

    def test_checksum_mismatch_is_refused(self):
        with tempfile.TemporaryDirectory() as root:
            write_batch(root, "box", "2026-10-01", HEADER + row(1, 1, "2026-10-01"), tamper=True)
            with self.assertRaises(ValueError):
                snap.freeze(root, "VIIRS_SNPP_NRT")

    def test_snapshot_id_is_stable(self):
        with tempfile.TemporaryDirectory() as root:
            write_batch(root, "box", "2026-10-01", HEADER + row(1, 1, "2026-10-01"))
            self.assertEqual(snap.freeze(root, "VIIRS_SNPP_NRT")["id"], snap.freeze(root, "VIIRS_SNPP_NRT")["id"])

    def test_compare_states_nothing_when_standard_does_not_cover_the_days(self):
        with tempfile.TemporaryDirectory() as root:
            write_batch(root, "box", "2026-10-01", HEADER + row(1, 1, "2026-10-01"))
            snapshot = snap.freeze(root, "VIIRS_SNPP_NRT")
        with mock.patch.object(snap, "source_coverage", return_value={}):
            report = snap.compare(snapshot, "unused")
        self.assertEqual(report["areas"]["box"]["verdict"], "not_comparable")
        self.assertNotIn("relativeChange", report["areas"]["box"])


class SensitivityTests(unittest.TestCase):
    def snapshot(self, total):
        return {"id": "s", "standardSource": "VIIRS_SNPP_SP", "areas": {"box": {"bbox": [0, 0, 10, 10], "firstDay": "2026-10-01", "lastDay": "2026-11-02", "dailyCounts": {"2026-10-01": total}}}}

    def run_sweep(self, total, per_year):
        coverage = {year: {"first_observed": f"{year}-01-01T00:00:00Z", "last_observed": f"{year}-12-31T23:59:00Z"} for year in range(2016, 2026)}
        items = [{"fireType": "vegetation", "confidenceClass": "nominal"}] * per_year
        with mock.patch.object(snap, "source_coverage", return_value=coverage), mock.patch.object(snap, "month_status", return_value="observed"), mock.patch.object(snap, "query", return_value=items):
            return snap.sensitivity(self.snapshot(total), "unused")["areas"]["box"]

    def test_scale_that_reaches_the_median_is_reported(self):
        result = self.run_sweep(100, 200)
        self.assertEqual(result["verdict"], "assessed")
        self.assertEqual(result["baselineMedian"], 200)
        self.assertEqual(result["scaleThatReachesMedian"], 2.0)

    def test_sweep_is_labelled_as_assumed_not_measured(self):
        coverage = {}
        with mock.patch.object(snap, "source_coverage", return_value=coverage), mock.patch.object(snap, "month_status", return_value="no_data"):
            report = snap.sensitivity(self.snapshot(100), "unused")
        self.assertIn("not measured", report["kind"])
        self.assertEqual(report["areas"]["box"]["verdict"], "insufficient_history")


if __name__ == "__main__":
    unittest.main()
