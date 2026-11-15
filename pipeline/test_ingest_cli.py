"""Process boundary checks never use real credentials or a remote database."""
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

SENTINEL = "cli-private-credential-sentinel"
SCRIPT = Path(__file__).with_name("run_ingest.py")


class JobCliTests(unittest.TestCase):
    def run_job(self, args, **env):
        result = subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True,
            text=True, timeout=10, env={**os.environ, "FIRMS_MAP_KEY": SENTINEL, "DATABASE_URL": "",
                                     "FIRMS_RAW_DIR": "", **env})
        self.assertNotIn(SENTINEL, result.stdout + result.stderr)
        self.assertNotIn("Traceback", result.stderr)
        self.assertEqual(result.returncode, 1)
        return json.loads(result.stdout)

    def test_bad_arguments_have_safe_error_without_echoing_the_argument(self):
        self.assertEqual(self.run_job(["--unknown", SENTINEL])["errorCode"], "INVALID_REQUEST")

    def test_missing_job_environment_is_explicit(self):
        result = self.run_job(["--region", "kalteng", "--source", "MODIS_NRT", "--start", "2026-11-09"])
        self.assertEqual(result["errorCode"], "CONFIG_MISSING")

    def test_malformed_dsn_has_safe_failure_without_logging_credentials(self):
        # Intentionally invalid DSN syntax fails before a network connection.
        result = self.run_job(["--region", "kalteng", "--source", "MODIS_NRT", "--start", "2026-11-09"],
                              DATABASE_URL=SENTINEL, FIRMS_RAW_DIR=".cache/cli-test-raw")
        self.assertEqual(result["errorCode"], "DATABASE_FAILED")
