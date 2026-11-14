import json
import unittest
from pathlib import Path

import harmonize_config as config
import harmonize_transfer as transfer

MODELS = Path(__file__).resolve().parent / "models"


def rows_for(domain, split, count, viirs, reference, month="2022-07", start=0):
    return [(month, split, domain, start + i, reference, viirs) for i in range(count)]


class TransferTests(unittest.TestCase):
    def setUp(self):
        self.models = {"raw_alignment": {}, "ratio_global": {"ratio": 0.25}}

    def test_small_slices_are_insufficient_not_pass_or_fail(self):
        result = transfer.judge(self.models, rows_for("australia", "test", 10, 40, 10), 100)
        self.assertEqual(result["verdict"], "insufficient")
        self.assertNotIn("frozen", result)

    def test_pass_and_fail_follow_the_frozen_thresholds(self):
        good = transfer.judge(self.models, rows_for("australia", "test", 200, 40, 10), 100)
        self.assertEqual(good["verdict"], "pass")
        biased = transfer.judge(self.models, rows_for("australia", "test", 200, 40, 5), 100)
        self.assertEqual(biased["verdict"], "fail")
        self.assertFalse(biased["checks"]["aggregateBias"])

    def test_config_hash_is_stable_and_tied_to_model_config(self):
        self.assertEqual(transfer.config_hash(), transfer.config_hash())
        self.assertEqual(transfer.TRANSFER_CONFIG["requiredConfigHash"], config.CONFIG_HASH)

    def test_status_never_upgrades_an_unvalidated_domain(self):
        model = {"ratio": 0.25, "validatedDomains": ["australia"]}
        pairs = rows_for("australia", "train", 300, 40, 10) + rows_for("maritime_southeast_asia", "train", 300, 40, 10)
        pairs += rows_for("australia", "test", 300, 40, 10) + rows_for("maritime_southeast_asia", "test", 300, 40, 10, start=1000)
        holdout = rows_for("australia", "holdout", 300, 40, 10, month="2012-07") + rows_for("maritime_southeast_asia", "holdout", 300, 40, 10, month="2012-07", start=1000)
        result = transfer.evaluate(model, pairs, holdout)
        self.assertEqual(result["domains"]["australia"]["status"], "confirmed")
        self.assertEqual(result["domains"]["maritime_southeast_asia"]["holdout"]["verdict"], "pass")
        self.assertEqual(result["domains"]["maritime_southeast_asia"]["status"], "stays-unvalidated")
        self.assertIsNotNone(result["domains"]["maritime_southeast_asia"]["note"])

    def test_validated_domain_failing_holdout_is_flagged(self):
        model = {"ratio": 0.25, "validatedDomains": ["australia"]}
        pairs = rows_for("australia", "train", 300, 40, 10) + rows_for("australia", "test", 300, 40, 10)
        holdout = rows_for("australia", "holdout", 300, 40, 4, month="2012-07")
        self.assertEqual(transfer.evaluate(model, pairs, holdout)["domains"]["australia"]["status"], "validated-but-not-confirmed-on-holdout")

    def test_published_benchmark_matches_its_config_and_leaves_model_unchanged(self):
        prefix = config.CONFIG_HASH[:12]
        path = MODELS / f"transfer-{prefix}.json"
        if not path.exists():
            self.skipTest("benchmark not generated")
        result = json.loads(path.read_text(encoding="utf-8"))
        model = json.loads((MODELS / f"model-{prefix}.json").read_text(encoding="utf-8"))
        self.assertEqual(result["transferConfigHash"], transfer.config_hash())
        self.assertEqual(result["configHash"], model["configHash"])
        self.assertEqual(result["models"]["ratio"], model["ratio"])
        for domain in model["unvalidatedDomains"]:
            self.assertEqual(result["domains"][domain]["status"], "stays-unvalidated")


if __name__ == "__main__":
    unittest.main()
