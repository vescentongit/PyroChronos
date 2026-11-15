import contextlib
import io
import os
import tempfile
import unittest
from unittest.mock import patch

import firms_archive
import firms_ingest
import sync_firms_dataset
import test_service


class DeploymentSafetyTests(unittest.TestCase):
    def test_on_demand_readiness_never_fetches_nasa_or_exposes_key(self):
        with patch.dict(os.environ, {"RESEARCH_DATA_DIR": "", "FIRMS_MAP_KEY": "synthetic-on-demand-key", "FIRMS_BLOB_BASE_URL": ""}):
            self.assertEqual(test_service.ServiceTests().call(path="/ready", method="GET"), (200, {"status": "ready"}))

    def test_cli_argument_errors_never_echo_secret_values(self):
        for module in (firms_archive, firms_ingest, sync_firms_dataset):
            output = io.StringIO()
            with contextlib.redirect_stderr(output), self.assertRaises(SystemExit):
                module.main(["--private-sentinel-token"])
            self.assertNotIn("private-sentinel-token", output.getvalue())

    def test_readiness_checks_dependency_without_exposing_environment(self):
        service = test_service.ServiceTests()
        with patch.dict(os.environ, {"RESEARCH_DATA_DIR": "/missing/private-sentinel", "FIRMS_BLOB_BASE_URL": ""}):
            self.assertEqual(service.call(path="/ready", method="GET"), (503, {"status": "not_ready"}))
        with tempfile.TemporaryDirectory() as root, patch.dict(os.environ, {"RESEARCH_DATA_DIR": root, "FIRMS_BLOB_BASE_URL": ""}):
            self.assertEqual(service.call(path="/ready", method="GET"), (200, {"status": "ready"}))

    def test_archive_exception_is_sanitized(self):
        output = io.StringIO()
        with patch.object(firms_archive, "already_done", return_value=False), patch.object(firms_archive, "process_year", side_effect=RuntimeError("postgresql://user:private-sentinel@host/db")), contextlib.redirect_stderr(output):
            self.assertEqual(firms_archive.main(["--source", "MODIS_SP", "--years", "2019"]), 1)
        self.assertNotIn("private-sentinel", output.getvalue())

    def test_empty_dataset_is_not_ready(self):
        with patch.dict(os.environ, {"RESEARCH_DATA_DIR": "", "FIRMS_BLOB_BASE_URL": "", "FIRMS_MAP_KEY": ""}):
            self.assertEqual(test_service.ServiceTests().call(path="/ready", method="GET")[0], 503)

    def test_archive_manifest_failure_is_sanitized(self):
        output = io.StringIO()
        with patch.object(firms_archive, "already_done", side_effect=OSError("/private-sentinel/path")), contextlib.redirect_stderr(output):
            self.assertEqual(firms_archive.main(["--source", "MODIS_SP", "--years", "2019"]), 1)
        self.assertNotIn("private-sentinel", output.getvalue())
