"""Diagnostic: harmonized VIIRS estimate versus native MODIS for small polygons on test years.

Usage:
  python pipeline/harmonize_polygon_check.py --polygons 120
Polygons are 0.5-degree boxes placed at random inside 1-degree cells that were active in the
training years of validated domains (seeded, so the sample is reproducible). Each polygon-year
of the test split is one unit. This checks the product unit (an arbitrary polygon) which the
cell-month evaluation does not cover; it is not part of the acceptance rule and tunes nothing.
"""

import argparse
import json
import random
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

import harmonize_config as config
from area_counts import count_source
from area_query import Polygon
from harmonize_pairs import ROOT, cell_center, read_pairs
from reference_baseline import harmonized_window, load_model

SEED = 20261112
BOX_DEGREES = 0.5
MINIMUM_REFERENCE_COUNT = 30


def sample_polygons(pairs_path, model, count):
    rows = read_pairs(pairs_path)
    active = sorted({r[3] for r in rows if r[1] == "train" and r[2] in model["validatedDomains"] and r[4] + r[5] > 0})
    rng = random.Random(SEED)
    chosen = rng.sample(active, min(count, len(active)))
    polygons = []
    for key in chosen:
        lon, lat = cell_center(key)
        west = lon - 0.5 + rng.random() * (1 - BOX_DEGREES)
        south = lat - 0.5 + rng.random() * (1 - BOX_DEGREES)
        ring = [[west, south], [west + BOX_DEGREES, south], [west + BOX_DEGREES, south + BOX_DEGREES], [west, south + BOX_DEGREES], [west, south]]
        polygons.append((key, config.domain_of(lon, lat), Polygon({"type": "Polygon", "coordinates": [ring]})))
    return polygons


def run(store_dir, pairs_path, model, count):
    units = []
    first, last = int(config.SPLIT["test"]["start"][:4]), int(config.SPLIT["test"]["end"][:4])
    for key, domain, polygon in sample_polygons(pairs_path, model, count):
        for year in range(first, last + 1):
            start, end = date(year, 1, 1), date(year, 12, 31)
            harmonized, raw_viirs, _ = harmonized_window(store_dir, polygon, model, start, end)
            reference = count_source(store_dir, config.REFERENCE_SOURCE, polygon, start.isoformat(), end.isoformat())
            months = reference["months"].values()
            if harmonized is None or any(m["count"] is None or m["status"] != "observed" for m in months):
                continue
            units.append({"cell": key, "domain": domain, "year": year, "harmonized": harmonized, "viirsRaw": raw_viirs, "modis": sum(m["count"] for m in months)})
    return units


def summarize(units):
    def block(items):
        usable = [u for u in items if u["modis"] >= MINIMUM_REFERENCE_COUNT]
        if not usable:
            return {"units": len(items), "unitsWithReferenceAtLeast30": 0}
        errors = [u["harmonized"] - u["modis"] for u in usable]
        ratios = sorted(u["harmonized"] / u["modis"] for u in usable)
        total = sum(u["modis"] for u in usable)
        return {
            "units": len(items),
            "unitsWithReferenceAtLeast30": len(usable),
            "relativeBias": sum(errors) / total,
            "medianRatioToModis": ratios[len(ratios) // 2],
            "withinQuarter": sum(abs(e) / u["modis"] <= 0.25 for e, u in zip(errors, usable)) / len(usable),
            "mae": sum(abs(e) for e in errors) / len(usable),
        }

    by_domain = defaultdict(list)
    for unit in units:
        by_domain[unit["domain"]].append(unit)
    return {"all": block(units), "byDomain": {d: block(items) for d, items in sorted(by_domain.items())}}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--polygons", type=int, default=120)
    parser.add_argument("--store", default=ROOT / "data" / "processed" / "detections", type=Path)
    parser.add_argument("--models", default=Path(__file__).resolve().parent / "models", type=Path)
    parser.add_argument("--pairs", default=ROOT / "data" / "processed" / "harmonization", type=Path)
    args = parser.parse_args(argv)
    prefix = config.CONFIG_HASH[:12]
    model = load_model(args.models / f"model-{prefix}.json")
    units = run(args.store, args.pairs / f"pairs-{prefix}.csv.gz", model, args.polygons)
    summary = {"schema": "polygon-check-1", "configHash": config.CONFIG_HASH, "evaluationId": model["evaluationId"], "seed": SEED, "boxDegrees": BOX_DEGREES, "polygons": args.polygons, "role": "diagnostic only; not part of the acceptance rule and not used for tuning", "unitsDefinition": "one polygon and one test-split calendar year with MODIS and VIIRS fully covered", **summarize(units)}
    path = args.models / f"polygon-check-{prefix}.json"
    path.write_text(json.dumps(summary, indent=1) + "\n", encoding="utf-8")
    model_path = args.models / f"model-{prefix}.json"
    model["polygonCheck"] = {key: summary["all"].get(key) for key in ("units", "unitsWithReferenceAtLeast30", "relativeBias", "withinQuarter", "medianRatioToModis")}
    model_path.write_text(json.dumps(model, indent=1) + chr(10), encoding="utf-8")
    print(json.dumps(summary["all"], indent=1))
    for domain, block in summary["byDomain"].items():
        print(domain, block)
    return 0


if __name__ == "__main__":
    sys.exit(main())
