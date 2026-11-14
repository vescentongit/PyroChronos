"""Private Blob reads and immutable, tiled FIRMS dataset snapshots."""
import hashlib
import json
import os
import re
import time
import zlib
from urllib.parse import urlsplit

import httpx

from detection_store import FORMAT_VERSION, RECORD, StoreError

PREFIX = "firms-v1"
SOURCES = ("MODIS_SP", "VIIRS_SNPP_SP")
MAX_METADATA = 2_000_000
MAX_TILE_BYTES = 16_000_000
MAX_QUERY_BYTES = 64_000_000


def document(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def sha256(body):
    return hashlib.sha256(body).hexdigest()


def checked_hash(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{64}", value):
        raise StoreError("INVALID_DATASET")
    return value


class PrivateBlob:
    def __init__(self, base=None, token=None):
        self.base = (base or os.environ.get("FIRMS_BLOB_BASE_URL", "")).rstrip("/")
        self.token = token or os.environ.get("BLOB_READ_WRITE_TOKEN", "")
        url = urlsplit(self.base)
        if (url.scheme != "https" or not re.fullmatch(r"[a-z0-9]+\.private\.blob\.vercel-storage\.com", url.netloc)
                or url.path or url.query or url.fragment or not self.token):
            raise StoreError("STORAGE_NOT_CONFIGURED")

    def read(self, key, limit=MAX_METADATA, byte_range=None, missing_ok=False, timeout=15):
        if not re.fullmatch(r"firms-v1/[a-z0-9/.-]+", key) or ".." in key:
            raise StoreError("INVALID_DATASET")
        headers = {"Authorization": f"Bearer {self.token}", "Accept-Encoding": "identity"}
        if byte_range is not None:
            start, length = byte_range
            headers["Range"] = f"bytes={start}-{start + length - 1}"
        try:
            with httpx.stream("GET", f"{self.base}/{key}", headers=headers, timeout=timeout,
                              follow_redirects=False) as response:
                if response.status_code == 404 and missing_ok:
                    return None
                if byte_range is None:
                    if response.status_code != 200:
                        raise StoreError("STORAGE_UNAVAILABLE")
                else:
                    expected = f"bytes {start}-{start + length - 1}/"
                    if response.status_code != 206 or not response.headers.get("content-range", "").startswith(expected):
                        raise StoreError("INVALID_RANGE_RESPONSE")
                if int(response.headers.get("content-length", "0")) > limit:
                    raise StoreError("CAPACITY_LIMIT")
                parts, size = [], 0
                for part in response.iter_bytes():
                    size += len(part)
                    if size > limit:
                        raise StoreError("CAPACITY_LIMIT")
                    parts.append(part)
                body = b"".join(parts)
                if byte_range is not None and len(body) != length:
                    raise StoreError("INVALID_RANGE_RESPONSE")
                return body
        except StoreError:
            raise
        except Exception:
            raise StoreError("STORAGE_UNAVAILABLE") from None

    def put(self, key, body, size=None, mutable=False):
        # Only the scheduled publisher imports the write SDK, never the web runtime.
        from vercel.blob import sync as blob

        result = blob.put_blob(key, body, access="private", add_random_suffix=False,
                               allow_overwrite=True, content_length=size,
                               cache_control_max_age=60 if mutable else 31536000,
                               content_type="application/json" if key.endswith(".json") else "application/octet-stream")
        if result.url != f"{self.base}/{key}":
            raise StoreError("STORAGE_CONFIGURATION_MISMATCH")
        return result


class BlobDataset:
    def __init__(self, storage, fingerprint=None):
        self.storage = storage
        self.deadline, self.received, self.reads = time.monotonic() + 100, 0, 0
        self.indexes, self.tiles = {}, {}
        if fingerprint is None:
            pointer = json.loads(self._read(f"{PREFIX}/latest.json"))
            digest = checked_hash(pointer["sha256"])
        else:
            if not isinstance(fingerprint, str) or not fingerprint.startswith("sha256:"):
                raise StoreError("INVALID_DATASET")
            digest = checked_hash(fingerprint[7:])
        body = self._read(f"{PREFIX}/releases/{digest}.json")
        if sha256(body) != digest:
            raise StoreError("DATASET_CHANGED")
        self.catalog = json.loads(body)
        if self.catalog.get("schemaVersion") != "firms-dataset-1" or set(self.catalog["sources"]) - set(SOURCES):
            raise StoreError("INVALID_DATASET")
        self.version = f"sha256:{digest}"

    def _read(self, key, limit=MAX_METADATA, byte_range=None):
        remaining = self.deadline - time.monotonic()
        if self.reads >= 1024 or remaining <= 0 or self.received >= MAX_QUERY_BYTES:
            raise StoreError("CAPACITY_LIMIT")
        self.reads += 1
        body = self.storage.read(key, min(limit, MAX_QUERY_BYTES - self.received), byte_range=byte_range,
                                 timeout=min(15, remaining))
        self.received += len(body)
        return body

    def fingerprint(self):
        return self.version

    def source_coverage(self, source_id):
        return {int(year): entry for year, entry in sorted(self.catalog["sources"].get(source_id, {}).items())
                if entry.get("detections_format") == FORMAT_VERSION}

    def month_path(self, source_id, month):
        entry = next((item for item in self.source_coverage(source_id).get(int(month[:4]), {}).get("months", [])
                      if item["month"] == month), None)
        return BlobMonth(self, entry)


class BlobMonth:
    def __init__(self, dataset, entry):
        self.dataset, self.entry = dataset, entry

    def exists(self):
        return self.entry is not None

    def iter_tiles(self, tiles, start_minute, end_minute):
        dataset = self.dataset
        digest = checked_hash(self.entry["indexSha256"])
        if digest not in dataset.indexes:
            body = dataset._read(f"{PREFIX}/indexes/{digest}.json")
            if sha256(body) != digest:
                raise StoreError("DATASET_CHANGED")
            dataset.indexes[digest] = json.loads(body)
        index = dataset.indexes[digest]
        if index["format"] != FORMAT_VERSION or index["recordFormat"] != RECORD.format:
            raise StoreError("INVALID_DATASET")
        object_hash = checked_hash(index["sha256"])
        if object_hash != self.entry["sha256"]:
            raise StoreError("DATASET_CHANGED")
        for tile in tiles:
            entry = index["blocks"].get(str(tile))
            if entry is None:
                continue
            offset, length, count, checksum = entry
            if (not all(isinstance(n, int) and n >= 0 for n in (offset, length, count))
                    or length == 0 or length > MAX_TILE_BYTES or count * RECORD.size > MAX_TILE_BYTES
                    or offset + length > self.entry["bytes"]):
                raise StoreError("CAPACITY_LIMIT")
            key = (object_hash, tile)
            if key not in dataset.tiles:
                data = dataset._read(f"{PREFIX}/objects/{object_hash}.pcd", length, (offset, length))
                if sha256(data) != checked_hash(checksum):
                    raise StoreError("DATASET_CHANGED")
                dataset.tiles[key] = data
            decoder = zlib.decompressobj()
            data = decoder.decompress(dataset.tiles[key], count * RECORD.size + 1)
            if len(data) != count * RECORD.size or not decoder.eof or decoder.unused_data:
                raise StoreError("INVALID_DATASET")
            for record in RECORD.iter_unpack(data):
                if start_minute <= record[2] < end_minute:
                    yield record
