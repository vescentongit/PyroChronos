import json
import os
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from area_counts import QUALITY_POLICY, build_manifest, count_area, month_status, source_coverage
from area_query import Polygon
from firms_archive import process_year
from research_adapter import build_result, daily_page, detections_page, polygon_from_area
from synthetic import MODIS_HEADER, VIIRS_HEADER, make_archive, modis_row, viirs_row

NOW = datetime(2026, 11, 11, 3, 0, tzinfo=timezone.utc)
KALTENG = polygon_from_area("kalteng")


class Response:
    status = 200

    def __init__(self, data):
        self.data = data
        self.pos = 0

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, size):
        chunk = self.data[self.pos : self.pos + size]
        self.pos += size
        return chunk


def build_archive(root, source, year, rows, header):
    path = root / f"{source}-{year}.zip"
    make_archive(path, {"X": rows}, header, year)
    process_year(source, year, root / "raw", root / "grid", opener=lambda request, timeout: Response(path.read_bytes()), store_dir=root / "store", now=NOW)


def fixture(root):
    """SYNTHETIC archives: MODIS 2018 complete, MODIS 2019 only to 2019-10-15; VIIRS 2019 complete; no 2020."""
    inside = lambda i: round(-2.4 - i * 0.01, 2)
    build_archive(root, "MODIS_SP", 2018, [modis_row(-2.4, 114.1, "2018-01-01"), modis_row(-2.4, 114.1, "2018-09-03"), modis_row(-2.4, 114.1, "2018-12-31")], MODIS_HEADER)
    build_archive(root, "MODIS_SP", 2019, [
        modis_row(-2.4, 114.1, "2019-01-01"),
        *[modis_row(inside(i), 114.1, "2019-09-03") for i in range(3)],
        modis_row(-2.4, 114.1, "2019-09-04", confidence=10),
        modis_row(-2.4, 114.1, "2019-09-04", time="0400", kind=2),
        modis_row(10, 10, "2019-09-03"),
        modis_row(-2.4, 114.1, "2019-10-15", time="2300"),
    ], MODIS_HEADER)
    build_archive(root, "VIIRS_SNPP_SP", 2019, [
        viirs_row(-2.4, 114.1, "2019-01-01"),
        viirs_row(-2.41, 114.1, "2019-09-03"),
        viirs_row(-2.42, 114.1, "2019-09-03"),
        viirs_row(-2.4, 114.1, "2019-12-31", time="2350"),
    ], VIIRS_HEADER)


class CountTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        fixture(self.root)
        self.store = self.root / "store"

    def tearDown(self):
        self.tmp.cleanup()

    def test_month_coverage_statuses(self):
        coverage = source_coverage(self.store, "MODIS_SP")
        self.assertEqual(month_status(coverage, "2018-09"), "observed")
        self.assertEqual(month_status(coverage, "2019-10"), "partial")
        self.assertEqual(month_status(coverage, "2019-11"), "no_data")
        self.assertEqual(month_status(coverage, "2020-03"), "no_data")
        self.assertEqual(month_status(coverage, "2018-03"), "observed")
        self.assertEqual(month_status(source_coverage(self.store, "VIIRS_SNPP_SP"), "2019-10"), "observed")

    def test_counts_by_source_with_exclusions_and_null_for_missing(self):
        counts = count_area(self.store, KALTENG, "2019-09-01", "2019-11-30")
        modis, viirs = counts["sources"]["MODIS_SP"], counts["sources"]["VIIRS_SNPP_SP"]
        self.assertEqual(modis["months"]["2019-09"]["count"], 3)
        self.assertEqual(modis["excluded"], {"lowConfidence": 1, "nonVegetationType": 1})
        self.assertEqual(modis["months"]["2019-10"], {"status": "partial", "count": 1, "satellites": ["Terra"]})
        self.assertIsNone(modis["months"]["2019-11"]["count"])
        self.assertEqual(viirs["months"]["2019-09"]["count"], 2)
        self.assertEqual(viirs["months"]["2019-10"]["status"], "observed")
        self.assertEqual(viirs["months"]["2019-10"]["count"], 0)
        self.assertEqual(modis["days"], {"2019-09-03": 3, "2019-10-15": 1})

    def test_manifest_is_reproducible_and_records_rules(self):
        counts = count_area(self.store, KALTENG, "2018-06-01", "2019-12-31")
        first = build_manifest(counts, KALTENG, "2026-11-11T03:00:00Z")
        second = build_manifest(counts, KALTENG, "2026-11-11T04:00:00Z")
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(first["geometryHash"], KALTENG.geometry_hash())
        modis = first["sources"]["MODIS_SP"]
        self.assertEqual(modis["monthsNoData"], ["2019-11", "2019-12"])
        self.assertIn("2019-10", modis["monthsPartial"])
        self.assertEqual(first["qualityPolicy"]["version"], QUALITY_POLICY["version"])
        self.assertIn("not cell-days", first["countDefinition"])
        self.assertIn("not treated as an equivalent series", first["overlapRule"])
        changed = dict(counts, policy={**QUALITY_POLICY, "confidenceClasses": ["high"]})
        self.assertNotEqual(build_manifest(changed, KALTENG, "x")["id"], first["id"])


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        fixture(self.root)
        self.store = self.root / "store"

    def tearDown(self):
        self.tmp.cleanup()

    def test_result_has_null_estimates_and_explicit_gaps(self):
        built = build_result(self.store, KALTENG, "2019-09-01", "2019-11-30", {"start": "2018-09-01", "end": "2018-09-30"}, now=NOW)
        result = built["result"]
        self.assertEqual(result["mode"], "research")
        self.assertEqual(result["method"]["validation"], "unsupported")
        self.assertEqual([m["month"] for m in result["months"]], ["2019-09", "2019-10", "2019-11"])
        september, october, november = result["months"]
        self.assertEqual(september["metric"]["rawCountsBySource"], {"MODIS_SP": 3, "VIIRS_SNPP_SP": 2})
        self.assertEqual(september["metric"]["status"], "method_unsupported")
        self.assertIsNone(september["metric"]["harmonizedCount"])
        self.assertEqual(october["metric"]["status"], "partial")
        self.assertEqual(november["metric"]["rawCountsBySource"], {"MODIS_SP": None, "VIIRS_SNPP_SP": 0})
        self.assertEqual(november["metric"]["rawCount"], 0)
        self.assertEqual(november["metric"]["status"], "partial")
        self.assertTrue(all(m["anomaly"]["status"] == "method_unsupported" for m in result["months"]))
        primary = result["primary"]
        self.assertEqual((primary["days"], primary["metric"]["rawCount"]), (91, 6))
        self.assertEqual(result["comparison"]["metric"]["rawCountsBySource"], {"MODIS_SP": 1, "VIIRS_SNPP_SP": None})
        self.assertEqual(result["method"]["manifestId"], built["manifest"]["id"])
        self.assertEqual({s["id"]: s["status"] for s in result["sources"]}, {"MODIS_SP": "partial", "VIIRS_SNPP_SP": "available"})

    def test_period_without_any_archive_is_no_data_not_zero(self):
        result = build_result(self.store, KALTENG, "2005-01-01", "2005-02-28", now=NOW)["result"]
        self.assertEqual(result["primary"]["metric"]["status"], "no_data")
        self.assertIsNone(result["primary"]["metric"]["rawCount"])
        self.assertTrue(all(m["metric"]["rawCount"] is None and m["anomaly"]["status"] == "insufficient_data" for m in result["months"]))
        self.assertTrue(all(s["status"] == "unavailable" and s["checksum"] is None for s in result["sources"]))

    def test_daily_page_marks_uncovered_days(self):
        built = build_result(self.store, KALTENG, "2019-10-10", "2019-10-20", now=NOW)
        page = daily_page(built["counts"], built["result"]["id"], "2019-10")
        by_day = {d["date"]: d["metric"]["rawCountsBySource"] for d in page["days"]}
        self.assertEqual(len(by_day), 11)
        self.assertEqual(by_day["2019-10-15"]["MODIS_SP"], 1)
        self.assertEqual(by_day["2019-10-12"]["MODIS_SP"], 0)

    def test_detections_page_is_ordered_paged_and_bound_to_query(self):
        page = detections_page(self.store, KALTENG, "analysis-local", "2019-09-01", "2019-10-31", limit=3)
        self.assertEqual(len(page["observations"]), 3)
        times = [o["observedAt"] for o in page["observations"]]
        self.assertEqual(times, sorted(times))
        self.assertIsNotNone(page["nextCursor"])
        rest = detections_page(self.store, KALTENG, "analysis-local", "2019-09-01", "2019-10-31", cursor=page["nextCursor"], limit=3)
        self.assertEqual(len(rest["observations"]), 3)
        self.assertIsNone(rest["nextCursor"])
        ids = [o["id"] for o in page["observations"] + rest["observations"]]
        self.assertEqual(len(ids), len(set(ids)))
        with self.assertRaises(ValueError):
            detections_page(self.store, KALTENG, "analysis-local", "2019-09-01", "2019-09-30", cursor=page["nextCursor"])
        with self.assertRaises(ValueError):
            detections_page(self.store, KALTENG, "analysis-local", "2019-09-01", "2019-10-31", cursor="not-a-cursor")
        modis = next(o for o in page["observations"] if o["sourceId"] == "MODIS_SP")
        self.assertEqual(modis["confidence"], "70")

    def test_dump_outputs_for_schema_validation(self):
        target = os.environ.get("ADAPTER_OUT")
        if not target:
            self.skipTest("ADAPTER_OUT not set")
        out = Path(target)
        out.mkdir(parents=True, exist_ok=True)
        built = build_result(self.store, KALTENG, "2019-09-01", "2019-11-30", {"start": "2018-09-01", "end": "2018-09-30"}, now=NOW)
        empty = build_result(self.store, KALTENG, "2005-01-01", "2005-02-28", now=NOW)
        crossing = Polygon({"type": "Polygon", "coordinates": [[[179.9, -0.1], [-179.9, -0.1], [-179.9, 0.1], [179.9, 0.1], [179.9, -0.1]]]})
        files = {
            "result.json": built["result"],
            "result-no-data.json": empty["result"],
            "result-antimeridian.json": build_result(self.store, crossing, "2019-09-01", "2019-09-30", now=NOW)["result"],
            "area.json": built["result"]["area"],
            "daily-page.json": daily_page(built["counts"], built["result"]["id"], "2019-09"),
            "detections-page.json": detections_page(self.store, KALTENG, built["result"]["id"], "2019-09-01", "2019-10-31", limit=2),
        }
        for name, payload in files.items():
            (out / name).write_text(json.dumps(payload), encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
