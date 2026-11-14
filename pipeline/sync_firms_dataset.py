"""Download changed FIRMS yearly archives and atomically publish a private Blob snapshot."""
import argparse
import copy
import json
import ssl
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from detection_store import FORMAT_VERSION, RECORD, StoreError, read_header
from firms_archive import process_year, sha256_file
from firms_blob import (
    MAX_METADATA,
    PREFIX,
    SOURCES,
    PrivateBlob,
    checked_hash,
    document,
    sha256,
)
from firms_catalog import archive_url, get_source


def probe_archive(url):
    request = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "PyroChronos-dataset-sync"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            status, headers = response.status, {k.lower(): v for k, v in response.headers.items()}
    except urllib.error.HTTPError as error:
        if error.code == 404:
            return None
        raise StoreError("ARCHIVE_UNAVAILABLE") from None
    except urllib.error.URLError as error:
        if not isinstance(error.reason, ssl.SSLCertVerificationError):
            raise StoreError("ARCHIVE_UNAVAILABLE") from None
        # Match the existing archive downloader's verified-TLS Windows curl fallback.
        result = subprocess.run(["curl", "-sS", "-I", "--connect-timeout", "10", "--max-time", "30", url],
                                capture_output=True, check=False)
        if result.returncode:
            raise StoreError("ARCHIVE_UNAVAILABLE") from None
        blocks = [block for block in result.stdout.decode("iso-8859-1").split("\r\n\r\n") if block.startswith("HTTP/")]
        lines = blocks[-1].splitlines()
        status = int(lines[0].split()[1])
        headers = {k.lower(): v.strip() for line in lines[1:] if ":" in line for k, v in [line.split(":", 1)]}
    if status == 404:
        return None
    if status != 200:
        raise StoreError("ARCHIVE_UNAVAILABLE")
    return {key: headers[key] for key in ("etag", "last-modified", "content-length", "x-amz-meta-sha256") if key in headers}


def load_catalog(storage):
    body = storage.read(f"{PREFIX}/latest.json", missing_ok=True)
    if body is None:
        return {"schemaVersion": "firms-dataset-1", "sources": {source: {} for source in SOURCES}}
    digest = checked_hash(json.loads(body)["sha256"])
    body = storage.read(f"{PREFIX}/releases/{digest}.json")
    if sha256(body) != digest:
        raise StoreError("DATASET_CHANGED")
    catalog = json.loads(body)
    if catalog.get("schemaVersion") != "firms-dataset-1" or set(catalog["sources"]) - set(SOURCES):
        raise StoreError("INVALID_DATASET")
    return catalog


def publish_year(storage, catalog, entry, root):
    """Upload immutable objects first; a failed upload leaves the latest snapshot unchanged."""
    entry = copy.deepcopy(entry)
    if entry["source"] not in SOURCES or entry["detections_format"] != FORMAT_VERSION or not entry["months"]:
        raise StoreError("INVALID_DATASET")
    for month in entry["months"]:
        path = Path(root) / month["file"]
        if path.stat().st_size != month["bytes"] or sha256_file(path) != checked_hash(month["sha256"]):
            raise StoreError("DATASET_CHANGED")
        header, base = read_header(path)
        if header["recordFormat"] != RECORD.format or header["source"] != entry["source"] or header["month"] != month["month"]:
            raise StoreError("INVALID_DATASET")
        blocks = {}
        with path.open("rb") as handle:
            for tile, (offset, length, count) in header["blocks"].items():
                handle.seek(base + offset)
                data = handle.read(length)
                if len(data) != length:
                    raise StoreError("INVALID_DATASET")
                blocks[tile] = [base + offset, length, count, sha256(data)]
            handle.seek(0)
            storage.put(f"{PREFIX}/objects/{month['sha256']}.pcd", handle, size=month["bytes"])
        index = document({"format": FORMAT_VERSION, "recordFormat": RECORD.format, "sha256": month["sha256"], "blocks": blocks})
        month["indexSha256"] = sha256(index)
        storage.put(f"{PREFIX}/indexes/{sha256(index)}.json", index)
    updated = copy.deepcopy(catalog)
    updated["sources"].setdefault(entry["source"], {})[str(entry["year"])] = entry
    body = document(updated)
    if len(body) > MAX_METADATA:
        raise StoreError("CAPACITY_LIMIT")
    digest = sha256(body)
    storage.put(f"{PREFIX}/releases/{digest}.json", body)
    if storage.read(f"{PREFIX}/releases/{digest}.json") != body:
        raise StoreError("DATASET_CHANGED")
    storage.put(f"{PREFIX}/latest.json", document({"sha256": digest}), mutable=True)
    return updated


def sync(storage, sources, first_year, last_year, force=False, probe=probe_archive, processor=process_year):
    catalog = load_catalog(storage)
    for source in sources:
        for year in range(max(first_year, get_source(source).first_year), last_year + 1):
            revision = probe(archive_url(source, year))
            previous = catalog["sources"].get(source, {}).get(str(year))
            if revision is None:
                print(f"{source} {year}: archive not available; existing snapshot retained", flush=True)
                continue
            if not force and previous and revision and previous.get("upstreamRevision") == revision:
                print(f"{source} {year}: unchanged", flush=True)
                continue
            with tempfile.TemporaryDirectory(prefix="pyro-firms-sync-") as folder:
                root = Path(folder)
                entry = processor(source, year, root / "raw", root / "grid", store_dir=root / "detections")
                upstream_hash = revision.get("x-amz-meta-sha256")
                if upstream_hash and entry["sha256"] != upstream_hash:
                    raise StoreError("ARCHIVE_CHANGED")
                entry["upstreamRevision"] = revision
                catalog = publish_year(storage, catalog, entry, root / "detections")
                print(f"{source} {year}: published {entry['detections']} original detections", flush=True)
    return catalog


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", choices=SOURCES, help="Omit to synchronize both research sources")
    parser.add_argument("--start-year", type=int, default=2000)
    parser.add_argument("--end-year", type=int, default=datetime.now(timezone.utc).year)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args(argv)
    if not 2000 <= args.start_year <= args.end_year <= datetime.now(timezone.utc).year:
        parser.error("Invalid year range")
    try:
        sync(PrivateBlob(), (args.source,) if args.source else SOURCES, args.start_year, args.end_year, args.force)
    except Exception as error:
        # Never print third-party exceptions: storage errors may contain authorization material.
        known = str(error) if isinstance(error, StoreError) else "DEPENDENCY_UNAVAILABLE"
        allowed = {"INVALID_DATASET", "DATASET_CHANGED", "ARCHIVE_CHANGED", "ARCHIVE_UNAVAILABLE", "CAPACITY_LIMIT",
                   "STORAGE_NOT_CONFIGURED", "STORAGE_CONFIGURATION_MISMATCH", "STORAGE_UNAVAILABLE"}
        print(f"FIRMS_SYNC_FAILED: {known if known in allowed else 'DEPENDENCY_UNAVAILABLE'}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
