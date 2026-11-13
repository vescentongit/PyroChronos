import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import research_worker
from research_adapter import build_result
from test_harmonization import KALTENG, MODEL, POLICY
from test_research_adapter import fixture


class P1ProducerTests(unittest.TestCase):
    def test_p1_keeps_its_frozen_model_instead_of_loading_local_defaults(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            fixture(root)
            store = root / "store"
            period = {"start": "2019-09-01", "end": "2019-09-30"}
            expected = build_result(store, KALTENG, **period, model=MODEL, baseline=POLICY)
            area = {"id": "area-synthetic", "name": "Synthetic test", "geometry": KALTENG.geometry, "geometryHash": "synthetic"}
            config = {"fingerprint": research_worker.fingerprint(store), "sources": ["MODIS_SP", "VIIRS_SNPP_SP"], "mode": "demo"}
            run = {"id": "job-synthetic", "workspaceId": "workspace-synthetic", "input": {
                "area": area, "producer": config,
                "request": {"period": period, "comparisonPeriod": None, "baseline": {"windowYears": 10}},
                "versions": {"dataVersion": expected["result"]["dataVersion"], "modelVersion": expected["result"]["method"]["version"]},
            }}
            with (
                patch.object(research_worker, "frozen_harmonization", return_value=(MODEL, POLICY)) as frozen,
                patch.object(research_worker, "load_default_harmonization", side_effect=AssertionError("P1 must retain frozen configuration")),
                patch.object(research_worker, "publication_manifest", return_value={"synthetic": True}),
            ):
                bundle = research_worker.produce(store, run)
            frozen.assert_called_once_with(config, 10)
            self.assertEqual(bundle["result"]["mode"], "demo")
            self.assertEqual(bundle["result"]["primary"]["metric"]["harmonizedCount"], 0.5)
            self.assertAlmostEqual(sum(day["metric"]["harmonizedCount"] for page in bundle["days"] for day in page["days"]), 0.5)

    def test_descriptor_freezes_versions_without_private_paths(self):
        self.assertTrue(callable(getattr(research_worker, "describe_producer", None)), "P1 producer descriptor is missing")
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            fixture(root)
            descriptor = research_worker.describe_producer(root / "store", models_dir=root / "models", build_commit="a" * 40)
            self.assertEqual(descriptor["schemaVersion"], "research-producer-config-1")
            self.assertIsNone(descriptor["model"])
            self.assertEqual(len(descriptor["archives"]["MODIS_SP"]), 2)
            self.assertNotIn(str(root), str(descriptor))


if __name__ == "__main__":
    unittest.main()
