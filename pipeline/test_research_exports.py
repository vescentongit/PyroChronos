import csv
import io
import unittest

from research_export import aggregate_rows, cell, raw_rows, write_csv


class ResearchExportTests(unittest.TestCase):
    def test_formula_prefixes_and_hidden_prefixes_are_neutralized(self):
        for prefix in ("=", "+", "-", "@", "\t", "\r"):
            for hidden in ("", " ", "\n", "\x00", "\ufeff", "\u200b"):
                value = hidden + prefix + "payload"
                self.assertEqual(cell(value), "'" + value)
        self.assertEqual(cell("ordinary text"), "ordinary text")
        self.assertEqual(cell("'already safe"), "'already safe")

    def test_missing_zero_negative_and_fractional_numbers_keep_their_types(self):
        self.assertEqual(cell(None), "")
        self.assertEqual(cell(0), 0)
        self.assertEqual(cell(-2.5), -2.5)
        self.assertEqual(cell(0.125), 0.125)
        self.assertEqual(cell(False), "false")

    def test_published_observation_rows_need_no_mutable_store(self):
        item = {"id": "original", "sourceId": "MODIS_SP", "observedAt": "2026-01-01T00:00:00Z", "coordinates": [-70.5, -1.25], "confidence": "=payload", "frpMw": None}
        stream = io.StringIO(newline="")
        header, rows = raw_rows(iter([item]))
        self.assertEqual(write_csv(stream, header, rows), 1)
        parsed = list(csv.DictReader(io.StringIO(stream.getvalue())))
        self.assertEqual(parsed[0]["longitude"], "-70.5")
        self.assertEqual(parsed[0]["confidence"], "'=payload")
        self.assertEqual(parsed[0]["frpMw"], "")
        self.assertEqual(parsed[0]["satellite"], "")

    def test_csv_quoting_preserves_unicode_quotes_commas_and_newlines(self):
        stream = io.StringIO(newline="")
        value = 'Hutan, "uji"\n日本語'
        write_csv(stream, ["notes", "zero", "missing"], [[value, 0, None]])
        self.assertEqual(list(csv.reader(io.StringIO(stream.getvalue()))), [["notes", "zero", "missing"], [value, "0", ""]])

    def test_aggregate_filter_never_exports_the_other_period_or_invents_months(self):
        metric = {"rawCountsBySource": {"MODIS_SP": None}, "rawCount": None, "harmonizedCount": None, "status": "no_data"}
        period = {"start": "2020-01-01", "end": "2020-01-31"}
        result = {
            "id": "analysis", "sources": [{"id": "MODIS_SP"}],
            "area": {"id": "area", "revision": 1, "geometryHash": "hash", "areaKm2": 1},
            "method": {"unit": "estimated-hotspot-detections", "referenceScale": "MODIS-equivalent", "name": "raw", "version": "1", "validation": "unsupported", "manifestId": "manifest"},
            "baseline": {"policyVersion": "baseline", "windowYears": 10, "minimumValidYears": 10},
            "dataVersion": "data", "qualityPolicyVersion": "quality",
            "primary": {"period": period, "days": 31, "metric": metric},
            "comparison": {"period": {"start": "2019-01-01", "end": "2019-01-31"}, "days": 31, "metric": metric},
            "months": [{"month": "2020-01", "metric": metric, "isPartialPeriod": False, "anomaly": {"status": "insufficient_data", "referenceYears": [], "baselineStatistic": None, "baselineValue": None, "delta": None, "scoreKind": None, "score": None}}],
        }
        header, rows = aggregate_rows(result, "comparison")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0][header.index("periodRole")], "comparison")
        self.assertIsNone(rows[0][header.index("harmonizedCount")])
        self.assertEqual(len(aggregate_rows(result, "primary")[1]), 2)
        with self.assertRaises(ValueError):
            aggregate_rows(result, "unknown")
        result["comparison"] = None
        with self.assertRaises(ValueError):
            aggregate_rows(result, "comparison")


if __name__ == "__main__":
    unittest.main()
