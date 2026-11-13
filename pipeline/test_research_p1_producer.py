import tempfile
import unittest
from pathlib import Path

import research_worker
from test_research_adapter import fixture


class P1ProducerTests(unittest.TestCase):
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
