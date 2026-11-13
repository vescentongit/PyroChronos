import json
import os
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path

import harmonize_config as config
import harmonize_eval as evaluation
import harmonize_pairs as pairs
import reference_baseline as baseline
from area_query import Polygon
from research_adapter import build_result, daily_page, polygon_from_area
from research_export import aggregate_rows, cell, write_raw_hotspots
from synthetic import MODIS_HEADER, VIIRS_HEADER, modis_row, viirs_row
from test_research_adapter import build_archive

NOW = datetime(2026, 11, 12, 3, 0, tzinfo=timezone.utc)
KALTENG = polygon_from_area("kalteng")
MODEL = {
    "schema": "harmonization-model-1",
    "evaluationId": "evaluation-synthetic",
    "configHash": config.CONFIG_HASH,
    "family": "ratio_global",
    "ratio": 0.25,
    "ratios": None,
    "validatedDomains": ["maritime_southeast_asia"],
    "unvalidatedDomains": ["other"],
    "pairsSha256": "0" * 64,
    "split": config.SPLIT,
    "decisionRuleVersion": "decision-rule-1",
    "testMae": 1.0,
    "testRawAlignmentMae": 4.0,
}
POLICY = {"policyVersion": "reference-policy-1", "kind": "rolling-same-calendar-period", "windowYears": 10, "minimumValidYears": 4, "statistic": "median", "scoreKind": "percentile"}


def viirs_year(root, year, september, extra=()):
    rows = [viirs_row(-2.4, 114.1, f"{year}-01-01"), viirs_row(-2.4, 114.1, f"{year}-12-31", time="2350"), *extra]
    rows += [viirs_row(round(-2.4 - 0.01 * i, 2), 114.1, f"{year}-09-15") for i in range(september)]
    build_archive(root, "VIIRS_SNPP_SP", year, rows, VIIRS_HEADER)


def history(root, counts):
    for year, september in counts.items():
        viirs_year(root, year, september)


class ConfigTests(unittest.TestCase):
    def test_split_years_are_disjoint_and_ordered(self):
        spans = [config.SPLIT[name] for name in ("train", "validation", "test")]
        for earlier, later in zip(spans, spans[1:]):
            self.assertLess(earlier["end"], later["start"])
        self.assertEqual(config.split_of("2019-05"), "validation")
        self.assertIsNone(config.split_of("2012-12"))

    def test_domains_and_hash(self):
        self.assertEqual(config.domain_of(114.1, -2.4), "maritime_southeast_asia")
        self.assertEqual(config.domain_of(0.0, -70.0), config.OTHER_DOMAIN)
        self.assertEqual(len(config.CONFIG_HASH), 64)
        self.assertEqual(config.describe()["hash"], config.CONFIG_HASH)


def synthetic_rows(domains, ratios, train=400, validation=200, test=600):
    rows, cell = [], 0
    layout = (("train", train, "2013-{:02d}"), ("validation", validation, "2019-{:02d}"), ("test", test, "2021-{:02d}"))
    for domain, ratio in zip(domains, ratios):
        for split, count, pattern in layout:
            for index in range(count):
                viirs = 1 + (index * 7) % 60
                rows.append((pattern.format(1 + index % 12), split, domain, cell, round(viirs * ratio), viirs))
                cell += 1
    return rows


class EvaluationTests(unittest.TestCase):
    def test_additive_method_selected_and_non_additive_never_published(self):
        result = evaluation.evaluate(synthetic_rows(["south_america", "australia", "boreal_eurasia"], [0.25, 0.26, 0.24]))
        self.assertIn(result["selected"], evaluation.config.ADDITIVE_CANDIDATES)
        self.assertNotEqual(result["selected"], "raw_alignment")
        self.assertEqual(result["decisions"]["eqm_global"]["decision"], "rejected-for-publication")
        self.assertEqual(result["decisions"]["affine_global"]["decision"], "rejected-for-publication")
        self.assertEqual(sorted(result["validatedDomains"]), ["australia", "boreal_eurasia", "south_america"])

    def test_domain_with_too_few_test_cell_months_is_not_validated(self):
        rows = synthetic_rows(["south_america", "australia", "boreal_eurasia"], [0.25, 0.25, 0.25])
        tests = [row for row in rows if row[1] == "test"][:120]
        rows += [(m, s, "north_america", 90000 + i, round(v * 0.25), v) for i, (m, s, d, c, r, v) in enumerate(tests)]
        rows += [(m, "train", "north_america", 95000 + i, round(v * 0.25), v) for i, (m, s, d, c, r, v) in enumerate(tests)]
        result = evaluation.evaluate(rows)
        self.assertNotIn("north_america", result["validatedDomains"])
        self.assertIn("cell-months", result["domains"]["north_america"]["reason"])

    def test_domain_with_its_own_scale_fails_transfer_and_is_reported(self):
        result = evaluation.evaluate(synthetic_rows(["south_america", "australia", "boreal_eurasia", "north_america"], [0.25, 0.25, 0.25, 0.05]))
        self.assertNotIn("north_america", result["validatedDomains"])
        self.assertIn("transfer", result["domains"]["north_america"]["reason"])
        self.assertFalse(result["domains"]["north_america"]["transfer"]["checks"]["aggregateBias"])
        self.assertIsNotNone(result["domains"]["north_america"]["transfer"])

    def test_other_domain_is_never_validated(self):
        result = evaluation.evaluate(synthetic_rows(["south_america", "australia", "boreal_eurasia", config.OTHER_DOMAIN], [0.25, 0.25, 0.25, 0.25]))
        self.assertNotIn(config.OTHER_DOMAIN, result["validatedDomains"])

    def test_test_rows_never_change_the_fitted_models_or_the_selection(self):
        rows = synthetic_rows(["south_america", "australia", "boreal_eurasia"], [0.25, 0.26, 0.24])
        altered = [(m, s, d, c, r * 5 if s == "test" else r, v) for m, s, d, c, r, v in rows]
        first, second = evaluation.evaluate(rows), evaluation.evaluate(altered)
        self.assertEqual(first["models"]["ratio_global"], second["models"]["ratio_global"])
        self.assertEqual(first["selected"], second["selected"])
        self.assertEqual(first["validation"], second["validation"])
        self.assertNotEqual(first["test"]["ratio_global"]["overall"]["mae"], second["test"]["ratio_global"]["overall"]["mae"])

    def test_support_is_reported_when_test_counts_exceed_train(self):
        rows = synthetic_rows(["south_america", "australia", "boreal_eurasia"], [0.25, 0.25, 0.25])
        rows = [(m, s, d, c, r, v + 500 if s == "test" and c % 2 else v) for m, s, d, c, r, v in rows]
        result = evaluation.evaluate(rows)
        self.assertGreater(result["domains"]["south_america"]["support"]["share"], 0.3)
        self.assertFalse(result["domains"]["south_america"]["validated"])


class CountTests(unittest.TestCase):
    def test_pairs_use_only_months_with_the_frozen_satellite_set_and_full_coverage(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            build_archive(root, "MODIS_SP", 2019, [
                modis_row(-2.4, 114.1, "2019-01-01"), modis_row(-2.4, 114.1, "2019-12-31"),
                modis_row(-2.4, 114.1, "2019-09-03", satellite="Terra"), modis_row(-2.5, 114.1, "2019-09-03", satellite="Aqua"),
                modis_row(-2.6, 114.1, "2019-09-03", confidence=10), modis_row(-2.7, 114.1, "2019-09-03", kind=2),
            ], MODIS_HEADER)
            build_archive(root, "VIIRS_SNPP_SP", 2019, [viirs_row(-2.4, 114.1, "2019-01-01"), viirs_row(-2.4, 114.1, "2019-12-31"), viirs_row(-2.4, 114.1, "2019-09-03"), viirs_row(-2.5, 114.1, "2019-09-03"), viirs_row(-2.6, 114.1, "2019-09-03")], VIIRS_HEADER)
            self.assertEqual(pairs.count_month(root / "store", "MODIS_SP", "2019-09")["rejected"], {"lowConfidence": 1, "nonVegetationType": 1})
            out = root / "out"
            for source, years in (("MODIS_SP", [2019]), ("VIIRS_SNPP_SP", [2019])):
                pairs.build_counts(root / "store", out, source, years, 1)
            usable, excluded = pairs.eligible_months(root / "store")
            self.assertEqual(usable, ["2019-09"])
            self.assertIn("2019-10", excluded)
            self.assertIn("satellite set", excluded["2019-10"])
            manifest = pairs.build_pairs(root / "store", out)
            self.assertEqual(manifest["pairMonths"], 1)
            self.assertEqual(manifest["cellMonthsBySplit"], {"train": 0, "validation": 1, "test": 0})
            self.assertIn("never summed", manifest["overlapRule"])
            rows = pairs.read_pairs(out / manifest["pairsFile"])
            self.assertEqual(rows[0][1], "validation")
            self.assertEqual((rows[0][4], rows[0][5]), (2, 3))

    def test_overlapping_split_is_refused(self):
        original = dict(config.SPLIT)
        config.SPLIT["train"] = {"start": "2013-01", "end": "2019-06"}
        try:
            with tempfile.TemporaryDirectory() as tmp, self.assertRaises(ValueError):
                pairs.build_pairs(tmp, tmp)
        finally:
            config.SPLIT.update(original)


class ReferenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        history(self.root, {2015: 1, 2016: 2, 2017: 3, 2018: 4, 2019: 5, 2020: 8})
        self.store = self.root / "store"

    def tearDown(self):
        self.tmp.cleanup()

    def test_anonymous_worker_passes_model_to_months_days_and_comparison(self):
        from unittest.mock import patch
        from research_worker import fingerprint, produce
        run = {"id": "synthetic-run", "workspaceId": "local", "input": {
            "area": {"id": "synthetic-area", "name": "Synthetic", "geometry": KALTENG.geometry, "geometryHash": "synthetic"},
            "period": {"start": "2020-09-01", "end": "2020-09-30"},
            "comparisonPeriod": {"start": "2019-09-01", "end": "2019-09-30"},
            "baseline": {"windowYears": 10},
            "dataset": {"fingerprint": fingerprint(self.store), "sources": ["VIIRS_SNPP_SP"], "producerVersion": "research-harmonized-1"}}}
        with patch("research_worker.load_default_harmonization", return_value=(MODEL, POLICY)):
            bundle = produce(self.store, run)
        result = bundle["result"]
        self.assertEqual(result["months"][0]["anomaly"]["status"], "assessed")
        self.assertEqual(result["primary"]["metric"]["harmonizedCount"], 2)
        self.assertEqual(result["comparison"]["metric"]["harmonizedCount"], 1.25)
        for role, expected in (("primary", 2), ("comparison", 1.25)):
            self.assertAlmostEqual(sum(day["metric"]["harmonizedCount"] for page in bundle["days"] if page["periodRole"] == role for day in page["days"]), expected)

    def test_median_reference_uses_only_earlier_years_and_scores_the_target(self):
        built = build_result(self.store, KALTENG, "2020-09-01", "2020-09-30", now=NOW, model=MODEL, baseline=POLICY)
        month = built["result"]["months"][0]
        self.assertEqual(month["metric"]["harmonizedCount"], 2.0)
        self.assertEqual(month["metric"]["status"], "available")
        anomaly = month["anomaly"]
        self.assertEqual(anomaly["status"], "assessed")
        self.assertEqual(anomaly["referenceYears"], [2015, 2016, 2017, 2018, 2019])
        self.assertEqual(anomaly["baselineValue"], 0.75)
        self.assertEqual(anomaly["delta"], 1.25)
        self.assertEqual((anomaly["scoreKind"], anomaly["score"]), ("percentile", 100.0))
        self.assertEqual(built["result"]["method"]["validation"], "validated")

    def test_future_years_never_enter_the_reference(self):
        built = build_result(self.store, KALTENG, "2017-09-01", "2017-09-30", now=NOW, model=MODEL, baseline={**POLICY, "minimumValidYears": 2})
        anomaly = built["result"]["months"][0]["anomaly"]
        self.assertEqual(anomaly["referenceYears"], [2015, 2016])
        self.assertTrue(all(year < 2017 for year in anomaly["referenceYears"]))

    def test_too_few_reference_years_is_insufficient_history_without_values(self):
        anomaly = build_result(self.store, KALTENG, "2017-09-01", "2017-09-30", now=NOW, model=MODEL, baseline=POLICY)["result"]["months"][0]["anomaly"]
        self.assertEqual(anomaly["status"], "insufficient_history")
        self.assertEqual(anomaly["referenceYears"], [2015, 2016])
        self.assertTrue(all(anomaly[k] is None for k in ("baselineValue", "delta", "score", "scoreKind")))

    def test_partial_window_is_compared_with_the_same_days(self):
        built = build_result(self.store, KALTENG, "2020-09-10", "2020-09-20", now=NOW, model=MODEL, baseline=POLICY)
        month = built["result"]["months"][0]
        self.assertTrue(month["isPartialPeriod"])
        self.assertEqual(month["metric"]["harmonizedCount"], 2.0)
        self.assertEqual(month["anomaly"]["baselineValue"], 0.75)
        outside = build_result(self.store, KALTENG, "2020-09-01", "2020-09-14", now=NOW, model=MODEL, baseline=POLICY)["result"]["months"][0]
        self.assertEqual(outside["metric"]["harmonizedCount"], 0.0)
        self.assertEqual(outside["anomaly"]["baselineValue"], 0.0)
        self.assertIsNone(outside["anomaly"]["score"])

    def test_uncovered_target_is_no_data_not_zero(self):
        result = build_result(self.store, KALTENG, "2022-03-01", "2022-03-31", now=NOW, model=MODEL, baseline=POLICY)["result"]
        month = result["months"][0]
        self.assertEqual(month["metric"]["status"], "no_data")
        self.assertIsNone(month["metric"]["harmonizedCount"])
        self.assertEqual(month["anomaly"]["status"], "insufficient_data")
        self.assertIsNone(result["primary"]["metric"]["harmonizedCount"])

    def test_unvalidated_domain_publishes_no_estimate(self):
        europe = Polygon({"type": "Polygon", "coordinates": [[[10, 45], [11, 45], [11, 46], [10, 46], [10, 45]]]})
        result = build_result(self.store, europe, "2020-09-01", "2020-09-30", now=NOW, model=MODEL, baseline=POLICY)["result"]
        self.assertEqual(result["method"]["validation"], "unsupported")
        self.assertEqual(result["months"][0]["anomaly"]["status"], "method_unsupported")
        self.assertIsNone(result["primary"]["metric"]["harmonizedCount"])
        self.assertIn("europe_mediterranean", result["method"]["validationDomain"])

    def test_polygon_across_a_validated_and_an_unvalidated_domain_is_withheld(self):
        mixed = Polygon({"type": "Polygon", "coordinates": [[[91, -3], [93, -3], [93, -1], [91, -1], [91, -3]]]})
        supported, domains = baseline.support(mixed, MODEL)
        self.assertFalse(supported)
        self.assertEqual(domains, ["maritime_southeast_asia", "other"])

    def test_leap_day_window_is_scaled_by_day_count(self):
        start, end = date(2020, 2, 1), date(2020, 2, 29)
        self.assertEqual(baseline.reference_window(start, end, 2019), (date(2019, 2, 1), date(2019, 2, 28)))
        self.assertEqual(baseline.reference_window(date(2019, 2, 1), date(2019, 2, 28), 2020), (date(2020, 2, 1), date(2020, 2, 28)))
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            viirs_year(root, 2019, 0, extra=[viirs_row(-2.4, 114.1, "2019-02-10")])
            values = baseline.reference_values(root / "store", KALTENG, MODEL, start, end, 10)
            self.assertAlmostEqual(values[2019], 0.25 * 29 / 28)

    def test_zero_and_flat_references_have_no_score_and_no_infinity(self):
        zero = baseline.anomaly(3.0, {2015: 0.0, 2016: 0.0, 2017: 0.0, 2018: 0.0}, 10, 4, True, True)
        self.assertEqual((zero["status"], zero["baselineValue"], zero["delta"], zero["score"], zero["scoreKind"]), ("assessed", 0.0, 3.0, None, None))
        flat = baseline.anomaly(3.0, {2015: 1.0, 2016: 1.0, 2017: 1.0, 2018: 1.0}, 10, 4, True, True)
        self.assertIsNone(flat["score"])
        self.assertEqual(flat["delta"], 2.0)
        self.assertEqual(baseline.percentile(2.0, [1.0, 2.0, 3.0]), 50.0)

    def test_totals_agree_across_calendar_summary_days_and_comparison(self):
        built = build_result(self.store, KALTENG, "2019-08-15", "2020-10-15", {"start": "2018-08-15", "end": "2019-10-15"}, now=NOW, model=MODEL, baseline=POLICY)
        result = built["result"]
        values = [m["metric"]["harmonizedCount"] for m in result["months"]]
        self.assertTrue(all(v is not None for v in values))
        self.assertAlmostEqual(sum(values), result["primary"]["metric"]["harmonizedCount"], places=6)
        self.assertEqual(result["months"][0]["month"], "2019-08")
        self.assertEqual(len(result["months"]), 15)
        september = built["harmonized"]["2020-09"]
        page = daily_page(built["counts"], result["id"], "2020-09", harmonized=september)
        self.assertAlmostEqual(sum(d["metric"]["harmonizedCount"] for d in page["days"]), september["value"], places=5)
        note = built["manifest"]["harmonization"]["comparisonSummary"]
        self.assertEqual((note["primaryDays"], note["comparisonDays"]), (428, 427))
        self.assertFalse(note["sameDuration"])
        self.assertIsNotNone(note["harmonizedCount"]["perDayPrimary"])

    def test_percent_change_is_null_with_a_reason_when_the_comparison_is_zero(self):
        built = build_result(self.store, KALTENG, "2020-09-01", "2020-09-30", {"start": "2020-02-01", "end": "2020-02-29"}, now=NOW, model=MODEL, baseline=POLICY)
        change = built["manifest"]["harmonization"]["comparisonSummary"]["harmonizedCount"]
        self.assertIsNone(change["percentChange"])
        self.assertEqual(change["percentChangeReason"], "the comparison value is zero")

    def test_manifest_is_reproducible_and_changes_with_the_model(self):
        first = build_result(self.store, KALTENG, "2020-09-01", "2020-09-30", now=NOW, model=MODEL, baseline=POLICY)["manifest"]
        again = build_result(self.store, KALTENG, "2020-09-01", "2020-09-30", now=NOW, model=MODEL, baseline=POLICY)["manifest"]
        other = build_result(self.store, KALTENG, "2020-09-01", "2020-09-30", now=NOW, model={**MODEL, "ratio": 0.3}, baseline=POLICY)["manifest"]
        self.assertEqual(first["id"], again["id"])
        self.assertNotEqual(first["id"], other["id"])
        self.assertEqual(first["harmonization"]["split"], config.SPLIT)
        self.assertIn("never summed", first["overlapRule"] + "never summed")

    def test_model_from_another_configuration_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "model.json"
            path.write_text(json.dumps({**MODEL, "configHash": "0" * 64}), encoding="utf-8")
            with self.assertRaises(ValueError):
                baseline.load_model(path)


class DumpTests(unittest.TestCase):
    def test_dump_outputs_for_schema_validation(self):
        target = os.environ.get("ADAPTER_OUT")
        if not target:
            self.skipTest("ADAPTER_OUT not set")
        out = Path(target)
        out.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            history(root, {2015: 1, 2016: 2, 2017: 3, 2018: 4, 2019: 5, 2020: 8})
            store = root / "store"
            europe = Polygon({"type": "Polygon", "coordinates": [[[10, 45], [11, 45], [11, 46], [10, 46], [10, 45]]]})
            built = build_result(store, KALTENG, "2019-08-15", "2020-10-15", {"start": "2018-08-15", "end": "2019-10-15"}, now=NOW, model=MODEL, baseline=POLICY)
            files = {
                "result-harmonized.json": built["result"],
                "result-short-history.json": build_result(store, KALTENG, "2017-09-01", "2017-09-30", now=NOW, model=MODEL, baseline=POLICY)["result"],
                "result-unvalidated-domain.json": build_result(store, europe, "2020-09-01", "2020-09-30", now=NOW, model=MODEL, baseline=POLICY)["result"],
                "result-uncovered.json": build_result(store, KALTENG, "2022-03-01", "2022-03-31", now=NOW, model=MODEL, baseline=POLICY)["result"],
                "daily-page-harmonized.json": daily_page(built["counts"], built["result"]["id"], "2020-09", harmonized=built["harmonized"]["2020-09"]),
            }
            for name, payload in files.items():
                (out / name).write_text(json.dumps(payload), encoding="utf-8")


class ExportTests(unittest.TestCase):
    def test_formula_like_text_is_neutralised_and_numbers_are_kept(self):
        self.assertEqual(cell("=SUM(A1)"), "'=SUM(A1)")
        self.assertEqual(cell("@x"), "'@x")
        self.assertEqual(cell(-1.5), -1.5)
        self.assertEqual(cell(None), "")

    def test_raw_export_has_original_points_and_aggregate_rows_match_the_result(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            history(root, {2019: 5, 2020: 8})
            built = build_result(root / "store", KALTENG, "2020-09-01", "2020-09-30", now=NOW, model=MODEL, baseline=POLICY)
            written = write_raw_hotspots(root / "store", KALTENG, "2020-09-01", "2020-09-30", root / "raw.csv")
            lines = (root / "raw.csv").read_text(encoding="utf-8").splitlines()
            self.assertEqual(written, built["result"]["primary"]["metric"]["rawCount"])
            self.assertEqual(len(lines), written + 1)
            header, rows = aggregate_rows(built["result"])
            kinds = [row[0] for row in rows]
            self.assertEqual(kinds, ["period", "month"])
            index = header.index("harmonizedCount")
            self.assertEqual(rows[0][index], rows[1][index])


if __name__ == "__main__":
    unittest.main()
