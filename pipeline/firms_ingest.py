"""Download FIRMS area batches into immutable raw files with a provenance manifest.

Usage:
  python pipeline/firms_ingest.py --area kalteng --source VIIRS_SNPP_NRT --start 2026-11-01 --end 2026-11-09
  --area accepts a featured region (kalteng, papua), world, or west,south,east,north.
  Long historical periods should use firms_archive.py instead of the area API.
The MAP_KEY is read from FIRMS_MAP_KEY (environment or .env) and is never written to disk.
"""

import argparse
import hashlib
import json
import os
import shutil
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from firms_catalog import BOUNDARY_VERSION, CATALOG_VERSION, FEATURED_REGIONS, MAX_DAY_RANGE, area_url, get_source, redact, resolve_area
from firms_parse import FirmsSchemaError, parse_batch

ROOT = Path(__file__).resolve().parent.parent
RETRY_STATUS = {429, 500, 502, 503, 504}


class FirmsIngestError(RuntimeError):
    pass


def curl_get(url, timeout=60):
    curl = shutil.which("curl")
    if not curl:
        raise FirmsIngestError("TLS verification failed and curl is not available")
    with tempfile.TemporaryDirectory() as folder:
        body_path = Path(folder) / "body"
        result = subprocess.run(
            [curl, "-sS", "-L", "--max-time", str(timeout), "-o", str(body_path), "-w", "%{http_code}", url],
            capture_output=True, text=True,
        )
        if result.returncode != 0:
            raise OSError(f"curl exit {result.returncode}")
        return int(result.stdout.strip() or 0), body_path.read_bytes() if body_path.exists() else b""


def http_get(url, timeout=60):
    request = urllib.request.Request(url, headers={"User-Agent": "PyroChronos-pipeline"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        return error.code, error.read()
    except urllib.error.URLError as error:
        if isinstance(error.reason, ssl.SSLCertVerificationError):
            return curl_get(url, timeout)
        raise


def chunks(start, end):
    """Split the inclusive date range into FIRMS requests of at most MAX_DAY_RANGE days."""
    if end < start:
        raise ValueError("end must not be before start")
    cursor = start
    while cursor <= end:
        days = min(MAX_DAY_RANGE, (end - cursor).days + 1)
        yield cursor, days
        cursor += timedelta(days=days)


def fetch_chunk(url, fetch=http_get, sleep=time.sleep, attempts=4):
    problem = None
    for attempt in range(attempts):
        try:
            status, body = fetch(url)
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            status, body, problem = None, b"", type(getattr(error, "reason", error)).__name__
        if status == 200:
            return status, body
        if status is not None and status not in RETRY_STATUS:
            raise FirmsIngestError(f"FIRMS responded {status}")
        if attempt < attempts - 1:
            sleep(min(60, 5 * 2**attempt))
    raise FirmsIngestError(f"FIRMS unavailable after {attempts} attempts (last status {status}, {problem or 'no network error'})")


def ingest(area, source_id, start, end, key, out_dir, fetch=http_get, sleep=time.sleep, now=None):
    if not key:
        raise FirmsIngestError("FIRMS_MAP_KEY is not configured")
    get_source(source_id)
    area_id, bbox = resolve_area(area)
    target = Path(out_dir) / source_id / area_id
    target.mkdir(parents=True, exist_ok=True)
    manifest = target / "manifest.jsonl"
    entries = []
    for chunk_start, days in chunks(start, end):
        url = area_url(key, source_id, bbox, days, chunk_start.isoformat())
        status, body = fetch_chunk(url, fetch, sleep)
        try:
            text = body.decode("utf-8")
        except UnicodeDecodeError:
            raise FirmsIngestError("FIRMS response is not UTF-8") from None
        window_start = datetime.combine(chunk_start, datetime.min.time(), timezone.utc)
        window = (window_start, window_start + timedelta(days=days))
        try:
            parsed = parse_batch(text, source_id, window)
        except FirmsSchemaError as error:
            raise FirmsIngestError(f"{error}; first line: {redact(text.splitlines()[0][:120] if text else '', key)!r}") from None
        digest = hashlib.sha256(body).hexdigest()
        raw = target / f"{chunk_start.isoformat()}_{days}d_{digest[:12]}.csv"
        if not raw.exists():
            raw.write_bytes(body)
        entry = {
            "catalog_version": CATALOG_VERSION,
            "source": source_id,
            "area": area_id,
            "featured": area_id in FEATURED_REGIONS,
            "boundary_version": BOUNDARY_VERSION if area_id in FEATURED_REGIONS else None,
            "bbox": list(bbox),
            "start_date": chunk_start.isoformat(),
            "day_range": days,
            "url": redact(url, key),
            "fetched_at": (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "http_status": status,
            "sha256": digest,
            "bytes": len(body),
            "path": raw.relative_to(Path(out_dir)).as_posix(),
            "status": parsed["status"],
            "counts": parsed["counts"],
            "warnings": parsed["warnings"],
            "reject_reasons": sorted({reject["reason"] for reject in parsed["rejects"]}),
        }
        with manifest.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry) + "\n")
        entries.append(entry)
    return entries


def read_key():
    key = os.environ.get("FIRMS_MAP_KEY", "").strip()
    env = ROOT / ".env"
    if not key and env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            name, _, value = line.partition("=")
            if name.strip() == "FIRMS_MAP_KEY":
                key = value.strip().strip('"').strip("'")
    return key


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--area", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--start", required=True, type=date.fromisoformat)
    parser.add_argument("--end", required=True, type=date.fromisoformat)
    parser.add_argument("--out", default=ROOT / "data" / "raw" / "firms", type=Path)
    args = parser.parse_args(argv)
    try:
        entries = ingest(args.area, args.source, args.start, args.end, read_key(), args.out)
    except (FirmsIngestError, ValueError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    for entry in entries:
        counts = entry["counts"]
        print(f"{entry['start_date']} +{entry['day_range']}d {entry['status']}: {counts['accepted']} accepted, {counts['rejected']} rejected, {counts['duplicates']} duplicates -> {entry['path']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
