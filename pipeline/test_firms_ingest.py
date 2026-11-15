import json
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path

from firms_ingest import FirmsIngestError, chunks, fetch_chunk, ingest
from test_firms_parse import V_ROW, VIIRS

NOW = datetime(2026, 11, 10, tzinfo=timezone.utc)


class Fake:
    def __init__(self, *responses):
        self.responses, self.urls = list(responses), []

    def __call__(self, url):
        self.urls.append(url)
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


class IngestTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.out = Path(self.dir.name)

    def tearDown(self):
        self.dir.cleanup()

    def test_range_is_split_into_five_day_requests(self):
        self.assertEqual(list(chunks(date(2019, 9, 1), date(2019, 9, 12))), [(date(2019, 9, 1), 5), (date(2019, 9, 6), 5), (date(2019, 9, 11), 2)])
        with self.assertRaises(ValueError):
            list(chunks(date(2019, 9, 2), date(2019, 9, 1)))

    def test_raw_batches_and_manifest_are_written_without_key(self):
        body = f"{VIIRS}\n{V_ROW}\n{V_ROW}\n".encode()
        fake = Fake((200, body), (200, f"{VIIRS}\n".encode()))
        entries = ingest("kalteng", "VIIRS_SNPP_SP", date(2019, 9, 10), date(2019, 9, 16), "SECRETKEY", self.out, fake, lambda s: None, NOW)
        self.assertEqual([e["day_range"] for e in entries], [5, 2])
        self.assertEqual(entries[0]["counts"]["duplicates"], 1)
        self.assertEqual(entries[1]["status"], "empty")
        raw = self.out / entries[0]["path"]
        self.assertEqual(raw.read_bytes(), body)
        manifest = (self.out / "VIIRS_SNPP_SP/kalteng/manifest.jsonl").read_text()
        self.assertEqual(len(manifest.splitlines()), 2)
        self.assertNotIn("SECRETKEY", manifest)
        first = json.loads(manifest.splitlines()[0])
        self.assertEqual(first["fetched_at"], "2026-11-10T00:00:00Z")
        self.assertTrue(first["featured"])

    def test_world_and_custom_bbox_areas_are_accepted(self):
        body = f"{VIIRS}\n".encode()
        fake = Fake((200, body), (200, body))
        world = ingest("world", "VIIRS_SNPP_NRT", date(2026, 11, 9), date(2026, 11, 9), "K", self.out, fake, lambda s: None, NOW)
        custom = ingest("-60,-15,-50,-5", "VIIRS_SNPP_NRT", date(2026, 11, 9), date(2026, 11, 9), "K", self.out, fake, lambda s: None, NOW)
        self.assertIn("/-180.0,-90.0,180.0,90.0/1/", fake.urls[0])
        self.assertEqual((world[0]["area"], world[0]["featured"], world[0]["boundary_version"]), ("world", False, None))
        self.assertEqual(custom[0]["area"], "bbox_-60_-15_-50_-5")

    def test_rerun_with_same_body_does_not_duplicate_raw_file(self):
        body = f"{VIIRS}\n{V_ROW}\n".encode()
        for _ in range(2):
            ingest("papua", "VIIRS_SNPP_SP", date(2019, 9, 10), date(2019, 9, 10), "K", self.out, Fake((200, body)), lambda s: None, NOW)
        self.assertEqual(len(list((self.out / "VIIRS_SNPP_SP/papua").glob("*.csv"))), 1)

    def test_rate_limit_retries_then_succeeds(self):
        sleeps = []
        fake = Fake((429, b""), OSError("reset"), (200, b"ok"))
        self.assertEqual(fetch_chunk("u", fake, sleeps.append), (200, b"ok"))
        self.assertEqual(sleeps, [5, 10])

    def test_permanent_errors_and_exhausted_retries_fail_loudly(self):
        with self.assertRaises(FirmsIngestError):
            fetch_chunk("u", Fake((403, b"")), lambda s: None)
        with self.assertRaises(FirmsIngestError):
            fetch_chunk("u", Fake(*[(503, b"")] * 4), lambda s: None)

    def test_missing_key_and_firms_error_text_fail(self):
        with self.assertRaises(FirmsIngestError):
            ingest("kalteng", "MODIS_SP", date(2019, 9, 1), date(2019, 9, 1), "", self.out)
        with self.assertRaises(FirmsIngestError) as caught:
            ingest("kalteng", "MODIS_SP", date(2019, 9, 1), date(2019, 9, 1), "SECRETKEY", self.out, Fake((200, b"Invalid MAP_KEY SECRETKEY")), lambda s: None, NOW)
        self.assertNotIn("SECRETKEY", str(caught.exception))
        self.assertFalse((self.out / "MODIS_SP/kalteng/manifest.jsonl").exists())


if __name__ == "__main__":
    unittest.main()
