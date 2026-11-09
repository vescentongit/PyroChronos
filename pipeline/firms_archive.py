"""Download FIRMS yearly global archives and aggregate them to a monthly global grid.

Usage:
  python pipeline/firms_archive.py --source MODIS_SP --years 2015-2020
  python pipeline/firms_archive.py --source VIIRS_SNPP_SP --years 2019 --keep-zip
No MAP_KEY is needed. Raw zips are verified by SHA-256, aggregated by streaming, and
removed after aggregation unless --keep-zip is given; the manifest keeps the checksum.
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
from firms_parse import FirmsSchemaError, RowParser

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


def aggregate(zip_path, source_id, year, size=CELL_DEGREES):
    """Stream every CSV in the archive into (month, cell, fire_type, confidence) totals."""
    totals = defaultdict(lambda: [0, 0.0, 0])
    stats = {"files": 0, "rows": 0, "accepted": 0, "rejected": 0, "wrong_year": 0, "first_observed": None, "last_observed": None}
    reasons, warnings = defaultdict(int), set()
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
                    parser = RowParser(header, source_id)
                except FirmsSchemaError as error:
                    raise ArchiveError(f"{member}: {error}") from None
                for line, row in enumerate(reader, start=2):
                    if not any(cell.strip() for cell in row):
                        continue
                    stats["rows"] += 1
                    record, reject = parser.parse(row, line)
                    if reject:
                        stats["rejected"] += 1
                        reasons[reject["reason"]] += 1
                        continue
                    observed = record["observed_at"]
                    if not observed.startswith(str(year)):
                        stats["wrong_year"] += 1
                        continue
                    stats["accepted"] += 1
                    stats["first_observed"] = min(filter(None, (stats["first_observed"], observed)))
                    stats["last_observed"] = max(filter(None, (stats["last_observed"], observed)))
                    x, y = cell_of(record["lon"], record["lat"], size)
                    entry = totals[(observed[:7], x, y, record["fire_type"] or "unknown", record["confidence_class"])]
                    entry[0] += 1
                    if record["frp_mw"] is None:
                        entry[2] += 1
                    else:
                        entry[1] += record["frp_mw"]
                warnings.update(parser.warnings)
    stats["reject_reasons"] = dict(sorted(reasons.items()))
    stats["warnings"] = sorted(warnings)
    return totals, stats


def write_grid(totals, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(path.suffix + ".part")
    with gzip.open(partial, "wt", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(GRID_COLUMNS)
        for (month, x, y, fire_type, confidence), (count, frp, missing) in sorted(totals.items()):
            writer.writerow((month, x, y, fire_type, confidence, count, round(frp, 3), missing))
    partial.replace(path)


def process_year(source_id, year, raw_dir, grid_dir, keep_zip=False, opener=urllib.request.urlopen, now=None):
    url = archive_url(source_id, year)
    zip_path = Path(raw_dir) / source_id / f"{year}.zip"
    if zip_path.exists():
        digest, size = sha256_file(zip_path), zip_path.stat().st_size
    else:
        digest, size = download(url, zip_path, opener)
    try:
        totals, stats = aggregate(zip_path, source_id, year)
    except zipfile.BadZipFile:
        zip_path.unlink(missing_ok=True)
        raise ArchiveError(f"{source_id} {year}: corrupt archive removed; rerun to download again") from None
    grid_path = Path(grid_dir) / source_id / f"{year}.csv.gz"
    write_grid(totals, grid_path)
    entry = {
        "catalog_version": CATALOG_VERSION,
        "grid_version": GRID_VERSION,
        "cell_degrees": CELL_DEGREES,
        "source": source_id,
        "year": year,
        "url": url,
        "sha256": digest,
        "bytes": size,
        "processed_at": (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "grid_path": grid_path.relative_to(Path(grid_dir)).as_posix(),
        "grid_rows": len(totals),
        **stats,
    }
    manifest = Path(grid_dir) / "manifest.jsonl"
    with manifest.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry) + "\n")
    if not keep_zip:
        zip_path.unlink(missing_ok=True)
    return entry


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
    args = parser.parse_args(argv)
    try:
        get_source(args.source)
        years = parse_years(args.years)
    except ValueError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    for year in years:
        try:
            entry = process_year(args.source, year, args.raw, args.grid, args.keep_zip)
        except (ArchiveError, ValueError, OSError) as error:
            print(f"{args.source} {year}: error: {error}", file=sys.stderr)
            return 1
        print(f"{args.source} {year}: {entry['accepted']:,} detections, {entry['rejected']} rejected, {entry['grid_rows']:,} grid rows, {entry['first_observed']} -> {entry['last_observed']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
