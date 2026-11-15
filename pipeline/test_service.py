"""Private service checks: no credentials, network, or real observations."""
import io
import json
import os
import tempfile
import unittest
from unittest.mock import patch

import app as service


class ServiceTests(unittest.TestCase):
    def call(self, body=None, path="/produce", method="POST", **overrides):
        content = json.dumps(body).encode()
        environ = {"PATH_INFO": path, "REQUEST_METHOD": method, "CONTENT_TYPE": "application/json",
                   "CONTENT_LENGTH": str(len(content)), "wsgi.input": io.BytesIO(content), **overrides}
        captured = {}

        def start_response(status, headers):
            captured.update(status=status, headers=dict(headers))

        value = json.loads(b"".join(service.app(environ, start_response)))
        self.assertEqual(captured["headers"]["Cache-Control"], "no-store")
        return int(captured["status"][:3]), value

    def test_routes_methods_and_bounded_input(self):
        self.assertEqual(self.call(path="/health", method="GET")[0], 200)
        self.assertEqual(self.call(path="/unknown")[0], 404)
        self.assertEqual(self.call(method="GET")[0], 405)
        for body in (None, [], {}, {"action": "describe"}, {"action": "fingerprint", "root": "/private"},
                     {"action": "produce", "run": {"input": {"producer": {}}}}):
            self.assertEqual(self.call(body)[0], 400)
        self.assertEqual(self.call({}, CONTENT_LENGTH="100001")[0], 400)
        self.assertEqual(self.call({}, CONTENT_TYPE="text/plain")[0], 400)

    def test_dataset_is_configured_on_pipeline_and_failures_are_sanitized(self):
        with patch.dict(os.environ, {"RESEARCH_DATA_DIR": ""}):
            self.assertEqual(self.call({"action": "fingerprint"})[0], 503)
        with tempfile.TemporaryDirectory() as root, patch.dict(os.environ, {"RESEARCH_DATA_DIR": root}):
            status, fingerprint = self.call({"action": "fingerprint"})
            self.assertEqual(status, 200)
            self.assertTrue(fingerprint.startswith("sha256:"))
            run = {"input": {"request": "test"}}
            with patch.object(service, "produce", return_value={"result": "test"}) as produce:
                self.assertEqual(self.call({"action": "produce", "run": run}), (200, {"result": "test"}))
                self.assertEqual(str(produce.call_args.args[0]), root)
            with patch.object(service, "produce", side_effect=ValueError("secret path /private")):
                self.assertEqual(self.call({"action": "produce", "run": run}), (503, {"code": "DEPENDENCY_UNAVAILABLE"}))
            with patch.object(service, "fingerprint", return_value="x" * service.MAX_RESPONSE_BYTES):
                self.assertEqual(self.call({"action": "fingerprint"}), (413, {"code": "PAYLOAD_TOO_LARGE"}))
            service._running.acquire()
            try:
                self.assertEqual(self.call({"action": "fingerprint"}), (503, {"code": "CAPACITY_LIMIT"}))
            finally:
                service._running.release()

    def test_analyze_with_empty_archive_returns_configuration_error(self):
        with tempfile.TemporaryDirectory() as root, patch.dict(os.environ, {"RESEARCH_DATA_DIR": root, "FIRMS_MAP_KEY": "synthetic-key"}):
            status, value = self.call({"action": "analyze", "run": {"input": {"dataset": {"sources": ["MODIS_SP", "VIIRS_SNPP_SP"]}}}})
            self.assertEqual((status, value), (503, {"code": "NOT_CONFIGURED"}))

    def test_missing_historical_configuration_is_not_a_data_or_network_result(self):
        request = {"action": "analyze", "run": {"input": {"dataset": {"sources": ["MODIS_SP", "VIIRS_SNPP_SP"]}}}}
        for root in ("", "/missing/private-sentinel"):
            with self.subTest(root=root), patch.dict(os.environ, {"RESEARCH_DATA_DIR": root, "FIRMS_BLOB_BASE_URL": "", "FIRMS_MAP_KEY": " "}):
                self.assertEqual(self.call(request), (503, {"code": "NOT_CONFIGURED"}))


if __name__ == "__main__":
    unittest.main()
