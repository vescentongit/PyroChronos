"""Download FIRMS yearly global archives into a tiled original-detection store and a coarse monthly grid.

Usage:
  python pipeline/firms_archive.py --source MODIS_SP --years 2015-2020
  python pipeline/firms_archive.py --source VIIRS_SNPP_SP --years 2019 --keep-zip
No MAP_KEY is needed. Raw zips are verified by SHA-256 and read by streaming. Original detections
(position, minute, FRP, satellite, type, confidence) go to data/processed/detections/{SOURCE}/{YYYY}/{YYYY-MM}.pcd;
the 0.25-degree grid derived from the same deduplicated records is a coarse aggregate only. The zip is
removed afterwards unless --keep-zip is given; manifests keep the archive checksum.
"""

import argparse
import csv
import gzip
import hashlib
import io
import json
import shutil
import ssl
import subprocess
import sys
import urllib.error
import urllib.request
import zipfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from firms_catalog import CATALOG_VERSION, archive_url, get_source
from detection_store import FORMAT_VERSION, BlockBuilder, RowDecoder, StoreError, write_month

ROOT = Path(__file__).resolve().parent.parent
GRID_VERSION = "grid-0.25deg-monthly-1"
CELL_DEGREES = 0.25
GRID_COLUMNS = ("month", "cell_x", "cell_y", "fire_type", "confidence", "detections", "frp_sum_mw", "frp_missing")


class ArchiveError(RuntimeError):
    pass


def download(url, path, opener=urllib.request.urlopen):
    """Stream url into path atomically and return (sha256, bytes)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(path.suffix + ".part")
    digest, size = hashlib.sha256(), 0
    request = urllib.request.Request(url, headers={"User-Agent": "PyroChronos-pipeline"})
    try:
        with opener(request, timeout=120) as response, partial.open("wb") as handle:
            if getattr(response, "status", 200) != 200:
                raise ArchiveError(f"archive responded {response.status}")
            while chunk := response.read(1 << 20):
                digest.update(chunk)
                size += len(chunk)
                handle.write(chunk)
    except urllib.error.URLError as error:
        partial.unlink(missing_ok=True)
        curl = shutil.which("curl")
        if not isinstance(error.reason, ssl.SSLCertVerificationError) or not curl or opener is not urllib.request.urlopen:
            raise
        result = subprocess.run([curl, "-fsSL", "--retry", "3", "-o", str(partial), url], capture_output=True, text=True)
        if result.returncode != 0:
            partial.unlink(missing_ok=True)
            raise ArchiveError(f"curl download failed ({result.returncode}): {result.stderr.strip()[:200]}") from None
        partial.replace(path)
        return sha256_file(path), path.stat().st_size
    except Exception:
        partial.unlink(missing_ok=True)
        raise
    partial.replace(path)
    return digest.hexdigest(), size


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def cell_of(lon, lat, size=CELL_DEGREES):
    columns, rows = round(360 / size), round(180 / size)
    return min(int((lon + 180) // size), columns - 1), min(int((lat + 90) // size), rows - 1)


def aggregate(zip_path, source_id, year, builder=None):
    """Stream every CSV in the archive, validate rows and pack them into per-month tile buckets."""
    builder = builder or BlockBuilder()
    stats = {"files": 0, "rows": 0, "accepted": 0, "rejected": 0, "wrong_year": 0}
    reasons, warnings = defaultdict(int), set()
    prefix = f"{year}-"
    with zipfile.ZipFile(zip_path) as archive:
        members = sorted(name for name in archive.namelist() if name.lower().endswith(".csv"))
        if not members:
            raise ArchiveError("archive contains no CSV files")
        for member in members:
            stats["files"] += 1
            with archive.open(member) as raw:
                reader = csv.reader(io.TextIOWrapper(raw, encoding="utf-8", newline=""))
                header = next(reader, None)
                if header is None:
                    continue
                try:
                    decoder = RowDecoder(header, source_id)
                except StoreError as error:
                    raise ArchiveError(f"{member}: {error}") from None
                decode, add = decoder.decode, builder.add
                for row in reader:
                    if not row or not any(row):
                        continue
                    stats["rows"] += 1
                    try:
                        month, tile, packed, _ = decode(row)
                    except ValueError as error:
                        stats["rejected"] += 1
                        reasons[str(error)] += 1
                        continue
                    if not month.startswith(prefix):
                        stats["wrong_year"] += 1
                        continue
                    stats["accepted"] += 1
                    add(month, tile, packed)
                warnings.update(decoder.warnings)
    stats["reject_reasons"] = dict(sorted(reasons.items()))
    stats["warnings"] = sorted(warnings)
    return builder, stats


def write_grid(totals, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(path.suffix + ".part")
    with gzip.open(partial, "wt", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(GRID_COLUMNS)
        for (month, x, y, fire_type, confidence), (count, frp, missing) in sorted(totals.items()):
            writer.writerow((month, x, y, fire_type, confidence, count, round(frp, 3), missing))
    partial.replace(path)


def process_year(source_id, year, raw_dir, grid_dir, keep_zip=False, opener=urllib.request.urlopen, now=None, store_dir=None):
    store_dir = Path(store_dir) if store_dir else Path(grid_dir).parent / "detections"
    url = archive_url(source_id, year)
    zip_path = Path(raw_dir) / source_id / f"{year}.zip"
    if zip_path.exists():
        digest, size = sha256_file(zip_path), zip_path.stat().st_size
    else:
        digest, size = download(url, zip_path, opener)
    try:
        builder, stats = aggregate(zip_path, source_id, year)
    except zipfile.BadZipFile:
        zip_path.unlink(missing_ok=True)
        raise ArchiveError(f"{source_id} {year}: corrupt archive removed; rerun to download again") from None
    totals = defaultdict(lambda: [0, 0.0, 0])
    months = []
    for month in builder.months():
        blocks, month_stats = builder.finalize_month(month, grid=totals, source_id=source_id, cell_degrees=CELL_DEGREES)
        months.append(write_month(store_dir, source_id, month, blocks, month_stats, digest))
        builder.drop_month(month)
    first = min((m["firstObserved"] for m in months if m["firstObserved"]), default=None)
    last = max((m["lastObserved"] for m in months if m["lastObserved"]), default=None)
    grid_path = Path(grid_dir) / source_id / f"{year}.csv.gz"
    write_grid(totals, grid_path)
    entry = {
        "catalog_version": CATALOG_VERSION,
        "grid_version": GRID_VERSION,
        "grid_resolution": "coarse-aggregate",
        "cell_degrees": CELL_DEGREES,
        "detections_format": FORMAT_VERSION,
        "source": source_id,
        "year": year,
        "url": url,
        "sha256": digest,
        "bytes": size,
        "processed_at": (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "grid_path": grid_path.relative_to(Path(grid_dir)).as_posix(),
        "grid_rows": len(totals),
        "first_observed": first,
        "last_observed": last,
        "detections": sum(m["count"] for m in months),
        "duplicates_removed": sum(m["duplicates"] for m in months),
        "months": months,
        **stats,
    }
    manifest = Path(store_dir) / source_id / "manifest.jsonl"
    manifest.parent.mkdir(parents=True, exist_ok=True)
    with manifest.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry) + "\n")
    legacy = Path(grid_dir) / "manifest.jsonl"
    with legacy.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps({k: v for k, v in entry.items() if k != "months"}) + "\n")
    if not keep_zip:
        zip_path.unlink(missing_ok=True)
    return entry


def already_done(store_dir, source_id, year):
    """True when the latest manifest entry for the year exists and all its month files are present."""
    manifest = Path(store_dir) / source_id / "manifest.jsonl"
    if not manifest.exists():
        return False
    entries = [json.loads(line) for line in manifest.read_text(encoding="utf-8").splitlines() if line.strip()]
    latest = next((e for e in reversed(entries) if e.get("year") == year and e.get("detections_format") == FORMAT_VERSION), None)
    return latest is not None and all((Path(store_dir) / m["file"]).exists() for m in latest["months"])


def parse_years(value):
    start, _, end = value.partition("-")
    first, last = int(start), int(end or start)
    if last < first:
        raise ValueError("years must be ascending")
    return range(first, last + 1)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--source", required=True)
    parser.add_argument("--years", required=True, help="2019 or 2015-2020")
    parser.add_argument("--raw", default=ROOT / "data" / "raw" / "firms_archive", type=Path)
    parser.add_argument("--grid", default=ROOT / "data" / "processed" / "grid", type=Path)
    parser.add_argument("--keep-zip", action="store_true")
    parser.add_argument("--force", action="store_true", help="reprocess years that are already in the store")
    args = parser.parse_args(argv)
    try:
        get_source(args.source)
        years = parse_years(args.years)
    except ValueError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    store = args.grid.parent / "detections"
    for year in years:
        if not args.force and already_done(store, args.source, year):
            print(f"{args.source} {year}: already in the store, skipped (use --force to redo)", flush=True)
            continue
        try:
            entry = process_year(args.source, year, args.raw, args.grid, args.keep_zip, store_dir=store)
        except (ArchiveError, ValueError, OSError) as error:
            print(f"{args.source} {year}: error: {error}", file=sys.stderr)
            return 1
        print(f"{args.source} {year}: {entry['detections']:,} detections ({entry['duplicates_removed']} duplicates removed, {entry['rejected']} rejected), {entry['first_observed']} -> {entry['last_observed']}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
