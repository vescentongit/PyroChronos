"""Fictional archives exercise publication, range reads, revisions, and failure recovery."""
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from area_query import Polygon, query
from detection_store import StoreError, source_coverage
from firms_archive import process_year
from firms_blob import PREFIX, BlobDataset, PrivateBlob, document, sha256
from research_p1_producer import fingerprint
from research_worker import produce
from sync_firms_dataset import load_catalog, publish_year, sync
from synthetic import MODIS_HEADER, make_archive, modis_row


class MemoryBlob:
    def __init__(self):
        self.objects, self.reads, self.writes = {}, [], []
        self.fail_key = None

    def put(self, key, body, size=None, mutable=False):
        if self.fail_key and self.fail_key in key:
            raise RuntimeError("synthetic failure")
        body = body.read() if hasattr(body, "read") else body
        if size is not None:
            assert len(body) == size
        self.objects[key] = body
        self.writes.append(key)

    def read(self, key, limit=2_000_000, byte_range=None, missing_ok=False, timeout=15):
        self.reads.append((key, byte_range))
        if key not in self.objects:
            if missing_ok:
                return None
            raise StoreError("STORAGE_UNAVAILABLE")
        body = self.objects[key]
        if byte_range:
            start, length = byte_range
            body = body[start:start + length]
        if len(body) > limit:
            raise StoreError("CAPACITY_LIMIT")
        return body


class DatasetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.storage = MemoryBlob()
        self.polygon = Polygon({"type": "Polygon", "coordinates": [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]]})
        self.entry = self.process("MODIS_SP", 2019, self.root / "raw", self.root / "grid", store_dir=self.root / "detections")
        self.catalog = publish_year(self.storage, load_catalog(self.storage), self.entry, self.root / "detections")

    def process(self, source, year, raw, grid, store_dir):
        path = Path(raw) / source / f"{year}.zip"
        path.parent.mkdir(parents=True, exist_ok=True)
        make_archive(path, {"fictional": [modis_row(2, 2, f"{year}-09-01"), modis_row(3, 3, f"{year}-09-30"),
                                          modis_row(70, 70, f"{year}-09-15")]}, MODIS_HEADER, year)
        return process_year(source, year, raw, grid, store_dir=store_dir)

    def test_remote_matches_local_and_fetches_only_intersecting_tiles(self):
        remote = BlobDataset(self.storage)
        expected = list(query(self.root / "detections", "MODIS_SP", self.polygon, "2019-09-01", "2019-09-30"))
        actual = list(query(remote, "MODIS_SP", self.polygon, "2019-09-01", "2019-09-30"))
        self.assertEqual(actual, expected)
        self.assertEqual(len(actual), 2)
        native = source_coverage(self.root / "detections", "MODIS_SP")[2019]
        self.assertEqual(source_coverage(remote, "MODIS_SP")[2019]["sha256"], native["sha256"])
        ranges = [value for key, value in self.storage.reads if key.endswith(".pcd")]
        self.assertEqual(len(ranges), 1)
        self.assertLess(ranges[0][1], self.entry["months"][0]["bytes"])
        reads = len(self.storage.reads)
        self.assertEqual(list(query(remote, "MODIS_SP", self.polygon, "2019-09-01", "2019-09-30")), expected)
        self.assertEqual(len(self.storage.reads), reads)
        self.assertEqual(fingerprint(remote), remote.fingerprint())

    def test_missing_history_is_absent_but_missing_or_corrupt_expected_data_fails(self):
        remote = BlobDataset(self.storage)
        self.assertEqual(list(query(remote, "MODIS_SP", self.polygon, "2001-09-01", "2001-09-30")), [])
        object_key = next(key for key in self.storage.objects if key.endswith(".pcd"))
        original = self.storage.objects.pop(object_key)
        with self.assertRaisesRegex(StoreError, "STORAGE_UNAVAILABLE"):
            list(query(remote, "MODIS_SP", self.polygon, "2019-09-01", "2019-09-30"))
        self.storage.objects[object_key] = bytes(len(original))
        with self.assertRaisesRegex(StoreError, "DATASET_CHANGED"):
            list(query(BlobDataset(self.storage), "MODIS_SP", self.polygon, "2019-09-01", "2019-09-30"))

    def test_real_producer_preserves_native_metrics_evidence_and_provenance(self):
        remote = BlobDataset(self.storage)
        local = self.root / "detections"
        area = {"id": "synthetic-area", "name": "Fictional", "geometry": self.polygon.geometry,
                "geometryHash": self.polygon.geometry_hash()}
        data = {"area": area, "period": {"start": "2019-09-01", "end": "2019-09-30"},
                "comparisonPeriod": None, "baseline": {"windowYears": 10},
                "dataset": {"fingerprint": fingerprint(local), "sources": ["MODIS_SP", "VIIRS_SNPP_SP"],
                            "producerVersion": "research-harmonized-1"}}
        run = {"id": "synthetic-run", "workspaceId": "synthetic-workspace", "input": data}
        native = produce(local, run)
        data["dataset"]["fingerprint"] = fingerprint(remote)
        hosted = produce(remote, run)
        self.assertEqual(hosted["result"]["primary"], native["result"]["primary"])
        self.assertEqual(hosted["result"]["dataVersion"], native["result"]["dataVersion"])
        self.assertEqual(hosted["manifest"]["contentSha256"], native["manifest"]["contentSha256"])
        self.assertEqual(hosted["detections"], native["detections"])
        self.assertEqual(hosted["days"], native["days"])

    def test_failed_publication_preserves_previous_snapshot_and_pinned_reads(self):
        pinned = BlobDataset(self.storage).fingerprint()
        old_pointer = self.storage.objects[f"{PREFIX}/latest.json"]
        self.storage.fail_key = "/indexes/"
        with self.assertRaises(RuntimeError):
            publish_year(self.storage, self.catalog, self.entry, self.root / "detections")
        self.assertEqual(self.storage.objects[f"{PREFIX}/latest.json"], old_pointer)
        self.storage.fail_key = None
        changed = copy.deepcopy(self.catalog)
        changed["sources"]["MODIS_SP"]["2019"]["processed_at"] = "2026-01-01T00:00:00Z"
        body = document(changed)
        self.storage.objects[f"{PREFIX}/releases/{sha256(body)}.json"] = body
        self.storage.objects[f"{PREFIX}/latest.json"] = document({"sha256": sha256(body)})
        self.assertNotEqual(BlobDataset(self.storage).fingerprint(), pinned)
        self.assertEqual(BlobDataset(self.storage, pinned).fingerprint(), pinned)

    def test_sync_resumes_skips_unchanged_and_retains_unavailable_years(self):
        revision = {"etag": "fictional-etag"}
        calls = []

        def processor(*args, **kwargs):
            calls.append(args[:2])
            return self.process(*args, **kwargs)

        updated = sync(self.storage, ("MODIS_SP",), 2019, 2019, probe=lambda url: revision, processor=processor)
        self.assertEqual(calls, [("MODIS_SP", 2019)])
        sync(self.storage, ("MODIS_SP",), 2019, 2019, probe=lambda url: revision, processor=processor)
        self.assertEqual(len(calls), 1)
        self.assertEqual(sync(self.storage, ("MODIS_SP",), 2019, 2019, probe=lambda url: None), updated)

    def test_catalog_hash_and_query_budget(self):
        digest = json.loads(self.storage.objects[f"{PREFIX}/latest.json"])["sha256"]
        self.storage.objects[f"{PREFIX}/releases/{digest}.json"] += b" "
        with self.assertRaisesRegex(StoreError, "DATASET_CHANGED"):
            BlobDataset(self.storage)
        self.storage.objects[f"{PREFIX}/releases/{digest}.json"] = document(self.catalog)
        remote = BlobDataset(self.storage)
        remote.reads = 1024
        with self.assertRaisesRegex(StoreError, "CAPACITY_LIMIT"):
            list(query(remote, "MODIS_SP", self.polygon, "2019-09-01", "2019-09-30"))

    def test_private_http_transport_checks_auth_ranges_size_and_redirects(self):
        for base in ("http://abc.private.blob.vercel-storage.com", "https://evil.example", "https://abc.private.blob.vercel-storage.com/path"):
            with self.assertRaises(StoreError):
                PrivateBlob(base, "synthetic-secret")
        storage = PrivateBlob("https://abc.private.blob.vercel-storage.com", "synthetic-secret")

        def handler(request):
            self.assertEqual(request.headers["authorization"], "Bearer synthetic-secret")
            self.assertEqual(request.headers["range"], "bytes=1-3")
            return httpx.Response(206, headers={"Content-Range": "bytes 1-3/10"}, content=b"123")

        with httpx.Client(transport=httpx.MockTransport(handler)) as client, patch("firms_blob.httpx.stream", client.stream):
            self.assertEqual(storage.read(f"{PREFIX}/objects/test.pcd", 3, (1, 3)), b"123")
        for response in (httpx.Response(200, content=b"123"), httpx.Response(302, headers={"location": "https://evil.example"}),
                         httpx.Response(206, headers={"Content-Range": "bytes 1-4/10"}, content=b"1234")):
            with httpx.Client(transport=httpx.MockTransport(lambda request, response=response: response)) as client, patch("firms_blob.httpx.stream", client.stream):
                with self.assertRaises(StoreError):
                    storage.read(f"{PREFIX}/objects/test.pcd", 3, (1, 3))


if __name__ == "__main__":
    unittest.main()
