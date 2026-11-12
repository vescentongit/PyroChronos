"""Cell-month counts per source and the frozen MODIS/VIIRS pair table (R2-P1-N1).

Usage:
  python pipeline/harmonize_pairs.py --counts
  python pipeline/harmonize_pairs.py --pairs
Counts apply quality-policy-1 to original detections in the pcd1 store and bin them to
1-degree cells per UTC month. Pairs only use months where both archives cover the whole
month and the satellite set is the frozen one, so the number of overpasses is constant
inside the training/validation/test windows. Original detections are never modified.
"""

import argparse
import csv
import gzip
import hashlib
import json
import sys
import zlib
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import harmonize_config as config
from area_counts import QUALITY_POLICY, month_status, source_coverage
from detection_store import FORMAT_VERSION, RECORD, SATELLITES, StoreError, month_path, read_header
from firms_catalog import get_source

ROOT = Path(__file__).resolve().parent.parent
PAIRS_VERSION = "pairs-1"
COLUMNS = 360


def accepted_confidence(source_id):
    if get_source(source_id).confidence_scheme == "percent":
        return lambda code: code >= 30
    return lambda code: code in (102, 103)


def count_month(store_dir, source_id, month):
    """Accepted detections per 1-degree cell for one source-month, plus exclusion totals."""
    path = month_path(store_dir, source_id, month)
    if not path.exists():
        return None
    header, base = read_header(path)
    if header["recordFormat"] != RECORD.format:
        raise StoreError(f"{path}: unsupported record format")
    ok = accepted_confidence(source_id)
    cells, rejected = {}, {"lowConfidence": 0, "nonVegetationType": 0}
    with path.open("rb") as handle:
        for tile, entry in sorted(header["blocks"].items(), key=lambda item: int(item[0])):
            handle.seek(base + entry[0])
            data = zlib.decompress(handle.read(entry[1]))
            for lat, lon, _, _, flags, conf in RECORD.iter_unpack(data):
                kind = (flags >> 3) & 7
                if kind not in (0, 4):
                    rejected["nonVegetationType"] += 1
                    continue
                if not ok(conf):
                    rejected["lowConfidence"] += 1
                    continue
                x = min((lon + 18000000) // 100000, 359)
                y = min((lat + 9000000) // 100000, 179)
                key = y * COLUMNS + x
                cells[key] = cells.get(key, 0) + 1
    return {"cells": cells, "rejected": rejected, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def _task(arguments):
    store_dir, source_id, month = arguments
    return month, count_month(store_dir, source_id, month)


def counts_path(out_dir, source_id, year):
    return Path(out_dir) / "cells" / f"{source_id}-{year}.json.gz"


def build_counts(store_dir, out_dir, source_id, years, jobs, force=False):
    for year in years:
        target = counts_path(out_dir, source_id, year)
        if target.exists() and not force:
            continue
        months = [f"{year}-{number:02d}" for number in range(1, 13)]
        with ProcessPoolExecutor(max_workers=jobs) as pool:
            results = dict(pool.map(_task, [(str(store_dir), source_id, month) for month in months]))
        payload = {
            "version": PAIRS_VERSION,
            "source": source_id,
            "year": year,
            "cellDegrees": config.CELL_DEGREES,
            "policy": QUALITY_POLICY["version"],
            "months": {month: {"cells": {str(k): v for k, v in sorted(r["cells"].items())}, "rejected": r["rejected"], "sha256": r["sha256"]} for month, r in results.items() if r is not None},
        }
        target.parent.mkdir(parents=True, exist_ok=True)
        partial = target.with_suffix(".part")
        with gzip.open(partial, "wt", encoding="utf-8") as handle:
            json.dump(payload, handle, separators=(",", ":"))
        partial.replace(target)
        total = sum(sum(m["cells"].values()) for m in payload["months"].values())
        print(f"{source_id} {year}: {len(payload['months'])} months, {total:,} accepted detections")


def load_counts(out_dir, source_id, years):
    result = {}
    for year in years:
        path = counts_path(out_dir, source_id, year)
        if not path.exists():
            continue
        with gzip.open(path, "rt", encoding="utf-8") as handle:
            data = json.load(handle)
        for month, entry in data["months"].items():
            result[month] = {"cells": {int(k): v for k, v in entry["cells"].items()}, "rejected": entry["rejected"], "sha256": entry["sha256"]}
    return result


def cell_center(key):
    return (key % COLUMNS) + 0.5 - 180, (key // COLUMNS) + 0.5 - 90


def month_range(start, end):
    year, number = map(int, start.split("-"))
    last_year, last_number = map(int, end.split("-"))
    while (year, number) <= (last_year, last_number):
        yield f"{year}-{number:02d}"
        number += 1
        if number > 12:
            year, number = year + 1, 1


def satellites_for(coverage, month):
    entry = coverage.get(int(month[:4]))
    if entry is None:
        return []
    return next((m["satellites"] for m in entry["months"] if m["month"] == month), [])


def eligible_months(store_dir):
    """Months usable as pairs and the reason each other month was left out."""
    reference = source_coverage(store_dir, config.REFERENCE_SOURCE)
    harmonized = source_coverage(store_dir, config.HARMONIZED_SOURCE)
    usable, excluded = [], {}
    first, last = config.SPLIT["train"]["start"], config.SPLIT["test"]["end"]
    for month in month_range(first, last):
        if month_status(reference, month) != "observed" or month_status(harmonized, month) != "observed":
            excluded[month] = "archive does not cover the whole month for both sources"
            continue
        ref_sats, har_sats = set(satellites_for(reference, month)), set(satellites_for(harmonized, month))
        if not set(config.REFERENCE_SATELLITES) <= ref_sats or har_sats != set(config.HARMONIZED_SATELLITES):
            excluded[month] = f"satellite set differs from the frozen configuration (reference {sorted(ref_sats)}, VIIRS {sorted(har_sats)})"
            continue
        usable.append(month)
    return usable, excluded


def build_pairs(store_dir, out_dir):
    out_dir = Path(out_dir)
    for first, second in (("train", "validation"), ("validation", "test"), ("train", "test")):
        if config.SPLIT[first]["end"] >= config.SPLIT[second]["start"]:
            raise ValueError(f"split overlap: {first}/{second}")
    usable, excluded = eligible_months(store_dir)
    years = sorted({int(month[:4]) for month in usable})
    reference = load_counts(out_dir, config.REFERENCE_SOURCE, years)
    harmonized = load_counts(out_dir, config.HARMONIZED_SOURCE, years)
    missing = [m for m in usable if m not in reference or m not in harmonized]
    if missing:
        raise ValueError(f"cell counts missing for {missing[:3]}...; run --counts first")
    path = out_dir / f"pairs-{config.CONFIG_HASH[:12]}.csv.gz"
    sizes = {"train": 0, "validation": 0, "test": 0}
    per_month = {}
    with gzip.open(path, "wt", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(["month", "split", "domain", "cell", "reference_count", "viirs_count"])
        for month in usable:
            split = config.split_of(month)
            ref, har = reference[month]["cells"], harmonized[month]["cells"]
            keys = sorted(set(ref) | set(har))
            for key in keys:
                lon, lat = cell_center(key)
                writer.writerow([month, split, config.domain_of(lon, lat), key, ref.get(key, 0), har.get(key, 0)])
            sizes[split] += len(keys)
            per_month[month] = {"cells": len(keys), "reference": sum(ref.values()), "viirs": sum(har.values())}
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    archive = {
        source: {
            str(year): {"sha256": entry["sha256"], "firstObserved": entry["first_observed"], "lastObserved": entry["last_observed"], "detections": entry["detections"]}
            for year, entry in source_coverage(store_dir, source).items()
            if year in years
        }
        for source in (config.REFERENCE_SOURCE, config.HARMONIZED_SOURCE)
    }
    manifest = {
        "schema": "pairs-manifest-1",
        "pairsVersion": PAIRS_VERSION,
        "storeFormat": FORMAT_VERSION,
        "config": config.describe(),
        "qualityPolicy": QUALITY_POLICY,
        "pairsFile": path.name,
        "pairsSha256": digest,
        "pairMonths": len(usable),
        "cellMonthsBySplit": sizes,
        "excludedMonths": excluded,
        "archiveRevisions": archive,
        "originalDetectionsUnchanged": "pair tables are aggregates; original points stay in the pcd1 store and are what the API returns",
        "overlapRule": "MODIS (Terra+Aqua, 4 nominal overpasses/day) is the reference; VIIRS S-NPP (2 nominal overpasses/day) is the input. The two are never summed. A third sensor (NOAA-20/21) would change the overpass count and requires a new configuration hash",
        "overpassEffect": "the satellite set is identical in every paired month, so overpass count is constant across train/validation/test and the fitted multiplier absorbs it; it does not transfer to a different satellite set",
        "leakage": "train, validation and test cover disjoint calendar years; fitting uses train only",
        "months": per_month,
    }
    (out_dir / f"pairs-{config.CONFIG_HASH[:12]}.manifest.json").write_text(json.dumps(manifest, indent=1) + "\n", encoding="utf-8")
    print(f"{len(usable)} paired months, cell-months {sizes}, excluded {len(excluded)} -> {path}")
    return manifest


def read_pairs(path):
    rows = []
    with gzip.open(path, "rt", encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            rows.append((row["month"], row["split"], row["domain"], int(row["cell"]), int(row["reference_count"]), int(row["viirs_count"])))
    return rows


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--counts", action="store_true")
    parser.add_argument("--pairs", action="store_true")
    parser.add_argument("--store", default=ROOT / "data" / "processed" / "detections", type=Path)
    parser.add_argument("--out", default=ROOT / "data" / "processed" / "harmonization", type=Path)
    parser.add_argument("--jobs", type=int, default=12)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args(argv)
    try:
        if args.counts:
            build_counts(args.store, args.out, config.REFERENCE_SOURCE, range(2000, 2026), args.jobs, args.force)
            build_counts(args.store, args.out, config.HARMONIZED_SOURCE, range(2012, 2026), args.jobs, args.force)
        if args.pairs:
            build_pairs(args.store, args.out)
    except (ValueError, StoreError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
