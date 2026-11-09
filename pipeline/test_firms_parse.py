import re
import unittest
from datetime import datetime, timezone
from pathlib import Path

from firms_catalog import FEATURED_REGIONS, WORLD, area_url, inside, redact, resolve_area
from firms_parse import FirmsSchemaError, parse_batch

VIIRS = "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight"
MODIS = "latitude,longitude,brightness,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_t31,frp,daynight"
V_ROW = "-2.5,114.0,330.1,0.4,0.4,2019-09-14,0545,N,VIIRS,n,2.0NRT,290.2,12.5,D"


class ParseTests(unittest.TestCase):
    def test_viirs_row_is_normalized_to_utc(self):
        result = parse_batch(f"{VIIRS}\n{V_ROW}\n", "VIIRS_SNPP_SP")
        record = result["records"][0]
        self.assertEqual(record["observed_at"], "2019-09-14T05:45:00Z")
        self.assertEqual(record["satellite"], "Suomi NPP")
        self.assertEqual(record["confidence_class"], "nominal")
        self.assertEqual(record["frp_mw"], 12.5)
        self.assertEqual(result["counts"], {"rows": 1, "accepted": 1, "rejected": 0, "duplicates": 0, "outside_window": 0})

    def test_modis_percent_confidence_maps_to_classes(self):
        rows = [f"-2.5,114.{i},320,1,1,2019-09-14,{t},T,MODIS,{c},6.1NRT,295,,D" for i, (t, c) in enumerate([("15", "10"), ("230", "30"), ("1200", "80")])]
        result = parse_batch("\n".join([MODIS, *rows]), "MODIS_SP")
        self.assertEqual([r["confidence_class"] for r in result["records"]], ["low", "nominal", "high"])
        self.assertEqual(result["records"][0]["observed_at"], "2019-09-14T00:15:00Z")
        self.assertEqual(result["records"][0]["satellite"], "Terra")
        self.assertIsNone(result["records"][0]["frp_mw"])

    def test_empty_body_and_header_only_are_empty_not_zero_detections(self):
        for body in ["", "﻿", f"{VIIRS}\n"]:
            result = parse_batch(body, "VIIRS_SNPP_NRT")
            self.assertEqual(result["status"], "empty")
            self.assertEqual(result["records"], [])

    def test_error_text_and_changed_schema_raise(self):
        for body in ["Invalid MAP_KEY.", "latitude,longitude,acq_date\n1,2,2019-01-01"]:
            with self.assertRaises(FirmsSchemaError):
                parse_batch(body, "VIIRS_SNPP_NRT")

    def test_bad_rows_are_rejected_with_raw_row_kept(self):
        bad = {
            "column_count": "-2.5,114.0,330",
            "coordinate": V_ROW.replace("-2.5", "-95"),
            "timestamp": V_ROW.replace("0545", "2575"),
            "confidence": V_ROW.replace(",n,", ",x,"),
            "frp": V_ROW.replace("12.5", "-3"),
        }
        result = parse_batch("\n".join([VIIRS, V_ROW, *bad.values()]), "VIIRS_SNPP_NRT")
        self.assertEqual(result["counts"]["accepted"], 1)
        self.assertEqual([r["reason"] for r in result["rejects"]], list(bad))
        self.assertTrue(all(r["raw"] for r in result["rejects"]))

    def test_duplicates_and_out_of_window_records_are_counted(self):
        late = V_ROW.replace("2019-09-14", "2019-09-10")
        window = (datetime(2019, 9, 12, tzinfo=timezone.utc), datetime(2019, 9, 17, tzinfo=timezone.utc))
        result = parse_batch("\n".join([VIIRS, V_ROW, V_ROW, late]), "VIIRS_SNPP_SP", window)
        self.assertEqual(result["counts"]["duplicates"], 1)
        self.assertEqual(result["counts"]["outside_window"], 1)
        self.assertEqual([r["outside_window"] for r in result["records"]], [False, True])

    def test_unknown_columns_and_satellites_warn(self):
        body = f"{VIIRS},extra\n{V_ROW.replace(',N,', ',X9,')},1\n"
        result = parse_batch(body, "VIIRS_SNPP_NRT")
        self.assertIn("unexpected column: extra", result["warnings"])
        self.assertIn("unknown satellite code: X9", result["warnings"])
        self.assertEqual(result["records"][0]["satellite"], "X9")

    def test_unknown_source_is_rejected(self):
        with self.assertRaises(ValueError):
            parse_batch(VIIRS, "VIIRS_FAKE")


class CatalogTests(unittest.TestCase):
    def test_regions_match_frontend_registry(self):
        registry = (Path(__file__).resolve().parent.parent / "src/lib/regions.ts").read_text(encoding="utf-8")
        found = dict(re.findall(r'id: "(\w+)" as const,.*?bounds: \[([^\]]+)\]', registry, re.S))
        self.assertEqual(set(found), set(FEATURED_REGIONS))
        for region, bounds in found.items():
            self.assertEqual(tuple(float(v) for v in bounds.split(",")), FEATURED_REGIONS[region])

    def test_url_is_built_and_key_redacted(self):
        url = area_url("SECRETKEY", "VIIRS_SNPP_SP", FEATURED_REGIONS["kalteng"], 5, "2019-09-01")
        self.assertTrue(url.endswith("/VIIRS_SNPP_SP/113.0,-3.6,115.0,-1.5/5/2019-09-01"))
        self.assertNotIn("SECRETKEY", redact(url, "SECRETKEY"))
        with self.assertRaises(ValueError):
            area_url("K", "VIIRS_SNPP_SP", WORLD, 6, "2019-09-01")

    def test_areas_resolve_to_featured_world_or_bbox(self):
        self.assertEqual(resolve_area("papua"), ("papua", FEATURED_REGIONS["papua"]))
        self.assertEqual(resolve_area("world"), ("world", WORLD))
        self.assertEqual(resolve_area("170,-20,-170,10"), ("bbox_170_-20_-170_10", (170.0, -20.0, -170.0, 10.0)))
        for bad in ["1,2,3", "0,10,5,5", "0,0,0,5", "a,b,c,d"]:
            with self.assertRaises(ValueError):
                resolve_area(bad)

    def test_antimeridian_bbox_contains_both_sides(self):
        box = (170.0, -20.0, -170.0, 10.0)
        self.assertTrue(inside(175, 0, box))
        self.assertTrue(inside(-175, 0, box))
        self.assertFalse(inside(0, 0, box))

    def test_archive_type_column_is_classified_and_validated(self):
        header = f"{MODIS},type"
        rows = [f"-2.5,114.{i},320,1,1,2019-09-14,0300,Aqua,MODIS,70,6.1,295,5,D,{t}" for i, t in enumerate(("0", "2"))]
        result = parse_batch("\n".join([header, *rows, rows[0][:-1] + "9"]), "MODIS_SP")
        self.assertEqual([r["fire_type"] for r in result["records"]], ["vegetation", "static"])
        self.assertEqual(result["rejects"][0]["reason"], "fire_type")


if __name__ == "__main__":
    unittest.main()
