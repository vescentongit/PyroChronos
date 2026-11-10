import gzip
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from firms_archive import ArchiveError, aggregate, cell_of, parse_years, process_year
from firms_calendar import anomaly, build, render
from test_firms_parse import MODIS

HEADER = f"{MODIS},type"


def row(lat, lon, day, confidence=70, kind=0, frp="5"):
    return f"{lat},{lon},320,1,1,{day},0300,Terra,MODIS,{confidence},6.1,295,{frp},D,{kind}"


def make_zip(path, files, year=2019):
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr(f"modis/{year}/", "")
        for name, rows in files.items():
            archive.writestr(f"modis/{year}/{name}.csv", "\n".join([HEADER, *rows]) + "\n")


class Response(io.BytesIO):
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


def opener_for(path):
    return lambda request, timeout: Response(path.read_bytes())


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_cells_cover_globe_edges(self):
        self.assertEqual(cell_of(-180, -90), (0, 0))
        self.assertEqual(cell_of(180, 90), (1439, 719))
        self.assertEqual(cell_of(114.1, -2.4), (1176, 350))

    def test_aggregate_counts_by_month_cell_type_and_confidence(self):
        path = self.dir / "a.zip"
        make_zip(path, {
            "Indonesia": [row(-2.4, 114.1, "2019-09-14"), row(-2.45, 114.15, "2019-09-20", frp=""), row(-2.4, 114.1, "2019-09-14", kind=2), row(-2.4, 114.1, "2019-10-01", confidence=10)],
            "Brazil": [row(-10, -55, "2019-08-01"), row(-10, -55, "2018-12-31"), "bad,row"],
        })
        totals, stats = aggregate(path, "MODIS_SP", 2019)
        self.assertEqual(totals[("2019-09", 1176, 350, "vegetation", "nominal")], [2, 5.0, 1])
        self.assertEqual(totals[("2019-09", 1176, 350, "static", "nominal")][0], 1)
        self.assertEqual(totals[("2019-10", 1176, 350, "vegetation", "low")][0], 1)
        self.assertEqual((stats["files"], stats["accepted"], stats["rejected"], stats["wrong_year"]), (2, 5, 1, 1))
        self.assertEqual((stats["first_observed"][:10], stats["last_observed"][:10]), ("2019-08-01", "2019-10-01"))
        self.assertEqual(stats["reject_reasons"], {"column_count": 1})

    def test_schema_mismatch_and_empty_archive_fail(self):
        bad = self.dir / "bad.zip"
        with zipfile.ZipFile(bad, "w") as archive:
            archive.writestr("x.csv", "latitude,longitude\n1,2\n")
        with self.assertRaises(ArchiveError):
            aggregate(bad, "MODIS_SP", 2019)
        empty = self.dir / "empty.zip"
        zipfile.ZipFile(empty, "w").close()
        with self.assertRaises(ArchiveError):
            aggregate(empty, "MODIS_SP", 2019)

    def test_process_year_downloads_writes_manifest_and_removes_zip(self):
        source = self.dir / "src.zip"
        make_zip(source, {"Indonesia": [row(-2.4, 114.1, "2019-09-14")]})
        entry = process_year("MODIS_SP", 2019, self.dir / "raw", self.dir / "grid", opener=opener_for(source))
        self.assertFalse((self.dir / "raw/MODIS_SP/2019.zip").exists())
        self.assertEqual(entry["bytes"], source.stat().st_size)
        self.assertIn("modis_2019_all_countries.zip", entry["url"])
        with gzip.open(self.dir / "grid" / entry["grid_path"], "rt") as handle:
            self.assertEqual(handle.read().splitlines()[1], "2019-09,1176,350,vegetation,nominal,1,5.0,0")
        manifest = (self.dir / "grid/manifest.jsonl").read_text().splitlines()
        self.assertEqual(json.loads(manifest[0])["sha256"], entry["sha256"])

    def test_years_and_sources_are_validated(self):
        self.assertEqual(list(parse_years("2018-2020")), [2018, 2019, 2020])
        with self.assertRaises(ValueError):
            parse_years("2020-2018")
        with self.assertRaises(ValueError):
            process_year("MODIS_NRT", 2019, self.dir, self.dir)
        with self.assertRaises(ValueError):
            process_year("VIIRS_SNPP_SP", 2010, self.dir, self.dir)


class CalendarTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.grid = Path(self.tmp.name)
        years = {
            2017: [row(-2.4, 114.1, "2017-01-01"), *[row(-2.4, 114.1, "2017-09-03")] * 2, row(-2.4, 114.1, "2017-12-31")],
            2018: [row(-2.4, 114.1, "2018-01-01"), *[row(-2.4, 114.1, "2018-09-03")] * 4, row(-2.4, 114.1, "2018-12-31")],
            2019: [row(-2.4, 114.1, "2019-01-01"), *[row(-2.4, 114.1, "2019-09-03")] * 9, row(10, 10, "2019-09-03"), row(-2.4, 114.1, "2019-09-04", kind=2), row(-2.4, 114.1, "2019-10-15")],
        }
        for year, rows in years.items():
            path = self.grid / f"{year}.zip"
            make_zip(path, {"X": rows}, year)
            process_year("MODIS_SP", year, self.grid / "raw", self.grid, opener=opener_for(path))

    def tearDown(self):
        self.tmp.cleanup()

    def test_calendar_filters_area_type_and_marks_coverage(self):
        result = build(self.grid, "MODIS_SP", "kalteng")
        months = {m["month"]: m for m in result["months"]}
        self.assertEqual(months["2019-09"]["detections"], 9)
        self.assertEqual(months["2018-03"], {"month": "2018-03", "status": "observed", "detections": 0, "frp_sum_mw": 0.0})
        self.assertEqual(months["2019-11"]["status"], "no_data")
        self.assertIsNone(months["2019-11"]["detections"])
        self.assertEqual(months["2019-10"]["status"], "partial")
        self.assertEqual(result["climatology"]["09"], {"median": 4, "years": 3})
        self.assertTrue(result["area"]["featured"])
        self.assertFalse(result["harmonized"])

    def test_world_includes_points_outside_featured_regions(self):
        world = build(self.grid, "MODIS_SP", "world")
        self.assertEqual(next(m for m in world["months"] if m["month"] == "2019-09")["detections"], 10)
        self.assertFalse(world["area"]["featured"])

    def test_anomaly_against_other_years(self):
        result = build(self.grid, "MODIS_SP", "kalteng")
        self.assertEqual(anomaly(result, "2019-09"), {"month": "2019-09", "status": "assessed", "value": 9, "median": 3.0, "difference": 6.0, "ratio": 3.0, "percentile": 100.0, "years": 2})
        self.assertEqual(anomaly(result, "2019-11")["status"], "no_data")
        self.assertEqual(anomaly(result, "2020-01")["status"], "no_data")
        self.assertIn("2019", render(result))

    def test_missing_grid_fails(self):
        with self.assertRaises(ValueError):
            build(self.grid / "none", "MODIS_SP", "world")


if __name__ == "__main__":
    unittest.main()
