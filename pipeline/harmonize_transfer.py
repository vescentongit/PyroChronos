"""Frozen-model transfer benchmark (R2-P2-N2).

Usage:
  python pipeline/harmonize_transfer.py
The model stays frozen (fitted on train 2013-2018 only). It is scored on data it never touched:
a backward holdout (2012-02..2012-12, before the train period), per-domain seasons of the test split,
and named regions inside and outside the two flagship areas. Thresholds are the frozen decision rule;
only the minimum sample sizes differ because the slices are smaller. Nothing here changes the model
or its validated domains; a domain is only reported as confirmed or not confirmed.
"""

import argparse
import hashlib
import json
import sys
from collections import defaultdict
from pathlib import Path

import harmonize_config as config
from harmonize_eval import fit_ratio, passes, score
from harmonize_pairs import ROOT, cell_center, load_counts, month_range, read_pairs
from reference_baseline import load_model

TRANSFER_VERSION = "transfer-1"

TRANSFER_CONFIG = {
    "version": TRANSFER_VERSION,
    "requiredConfigHash": config.CONFIG_HASH,
    "holdout": {"start": "2012-02", "end": "2012-12", "role": "backward holdout: before the train period, never used for fitting, selection or testing"},
    "minimumCellMonths": {"holdoutDomain": 200, "seasonDomain": 100, "region": 60},
    "thresholds": {
        "minimumMaeReductionVersusRaw": config.DECISION_RULE["minimumMaeReductionVersusRaw"],
        "maximumAbsoluteRelativeBiasAggregated": config.DECISION_RULE["maximumAbsoluteRelativeBiasAggregated"],
    },
    "seasons": config.SEASONS,
    "regions": {
        "rondonia_brazil": [-65.0, -14.0, -59.0, -8.0],
        "cerrado_matopiba_brazil": [-50.0, -13.0, -43.0, -5.0],
        "miombo_southern_africa": [22.0, -16.0, 34.0, -8.0],
        "sahel_savanna_west_africa": [-5.0, 8.0, 15.0, 14.0],
        "northern_australia": [125.0, -20.0, 145.0, -11.0],
        "siberia_baikal": [100.0, 50.0, 120.0, 60.0],
        "california_usa": [-124.5, 32.0, -114.0, 42.0],
        "kalimantan_tengah_indonesia": [111.0, -3.5, 115.0, 0.0],
        "papua_indonesia": [131.0, -9.0, 141.0, -1.0],
    },
    "rule": "slices below their minimum cell-month count are reported as insufficient, never as pass or fail; the model is not refitted, retuned or re-selected from any result here",
}


def config_hash():
    return hashlib.sha256(json.dumps(TRANSFER_CONFIG, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def holdout_rows(counts_dir):
    start, end = TRANSFER_CONFIG["holdout"]["start"], TRANSFER_CONFIG["holdout"]["end"]
    months = list(month_range(start, end))
    years = sorted({int(m[:4]) for m in months})
    reference = load_counts(counts_dir, config.REFERENCE_SOURCE, years)
    viirs = load_counts(counts_dir, config.HARMONIZED_SOURCE, years)
    missing = [m for m in months if m not in reference or m not in viirs]
    if missing:
        raise ValueError(f"cell counts missing for {missing[:3]}; run harmonize_pairs.py --counts first")
    rows = []
    for month in months:
        ref, har = reference[month]["cells"], viirs[month]["cells"]
        for key in sorted(set(ref) | set(har)):
            lon, lat = cell_center(key)
            rows.append((month, "holdout", config.domain_of(lon, lat), key, ref.get(key, 0), har.get(key, 0)))
    return rows


def season_of(month):
    number = int(month[5:])
    return next(name for name, months in TRANSFER_CONFIG["seasons"].items() if number in months)


def judge(models, rows, minimum):
    if len(rows) < minimum:
        return {"cellMonths": len(rows), "verdict": "insufficient", "minimumCellMonths": minimum}
    raw = score("raw_alignment", models, rows)
    frozen = score("ratio_global", models, rows)
    rule = {**config.DECISION_RULE, "minimumTestCellMonths": minimum}
    checks = passes(frozen, raw, rule)
    ok = checks["enoughCellMonths"] and checks["maeReduction"] and checks["aggregateBias"]
    return {
        "cellMonths": len(rows),
        "verdict": "pass" if ok else "fail",
        "raw": {k: raw[k] for k in ("mae", "aggregateRelativeBias")},
        "frozen": {k: frozen[k] for k in ("mae", "relativeBias", "aggregateRelativeBias")},
        "maeReduction": checks["reduction"],
        "checks": {"maeReduction": checks["maeReduction"], "aggregateBias": checks["aggregateBias"]},
    }


def in_box(cell, box):
    lon, lat = cell_center(cell)
    west, south, east, north = box
    return west <= lon <= east and south <= lat <= north


def evaluate(model, pairs_rows, holdout):
    models = {"raw_alignment": {}, "ratio_global": {"ratio": model["ratio"]}}
    cfg = TRANSFER_CONFIG["minimumCellMonths"]
    test = [r for r in pairs_rows if r[1] == "test"]
    train = [r for r in pairs_rows if r[1] == "train"]
    domains = sorted({r[2] for r in pairs_rows} | {r[2] for r in holdout})
    per_domain = {}
    for domain in domains:
        hold = [r for r in holdout if r[2] == domain]
        in_test = [r for r in test if r[2] == domain]
        seasons = {}
        for season in TRANSFER_CONFIG["seasons"]:
            seasons[season] = judge(models, [r for r in in_test if season_of(r[0]) == season], cfg["seasonDomain"])
        own_train = [r for r in train if r[2] == domain]
        own_ratio = fit_ratio(own_train) if len(own_train) >= 200 else None
        retrain = None
        if own_ratio is not None and domain != config.OTHER_DOMAIN:
            retrain = {"role": "reference only: ratio refitted on this domain's train rows; never published", "ratio": own_ratio, "holdout": judge({"raw_alignment": {}, "ratio_global": {"ratio": own_ratio}}, hold, cfg["holdoutDomain"])}
        validated = domain in model["validatedDomains"]
        holdout_result = judge(models, hold, cfg["holdoutDomain"])
        if validated and holdout_result["verdict"] == "pass":
            status = "confirmed"
        elif validated and holdout_result["verdict"] == "fail":
            status = "validated-but-not-confirmed-on-holdout"
        elif validated:
            status = "validated-holdout-insufficient"
        else:
            status = "stays-unvalidated"
        per_domain[domain] = {
            "validatedByFrozenConfig": validated,
            "holdout": holdout_result,
            "test": judge(models, in_test, cfg["holdoutDomain"]),
            "seasons": seasons,
            "retrainReference": retrain,
            "status": status,
            "note": "status never upgrades an unvalidated domain; opening one requires a new configuration and a new unseen evaluation" if not validated and holdout_result["verdict"] == "pass" else None,
        }
    regions = {}
    for name, box in TRANSFER_CONFIG["regions"].items():
        hold = [r for r in holdout if in_box(r[3], box)]
        in_test = [r for r in test if in_box(r[3], box)]
        domains_hit = sorted({r[2] for r in in_test + hold})
        regions[name] = {"box": box, "domains": domains_hit, "holdout": judge(models, hold, cfg["region"]), "test": judge(models, in_test, cfg["region"])}
    return {"models": {"ratio": model["ratio"]}, "domains": per_domain, "regions": regions}


def build(models_dir, pairs_dir, counts_dir):
    prefix = config.CONFIG_HASH[:12]
    model = load_model(Path(models_dir) / f"model-{prefix}.json")
    pairs_rows = read_pairs(Path(pairs_dir) / f"pairs-{prefix}.csv.gz")
    holdout = holdout_rows(counts_dir)
    body = evaluate(model, pairs_rows, holdout)
    content = {
        "schema": "transfer-benchmark-1",
        "transferConfig": TRANSFER_CONFIG,
        "transferConfigHash": config_hash(),
        "configHash": config.CONFIG_HASH,
        "evaluationId": model["evaluationId"],
        "pairsSha256": model["pairsSha256"],
        "holdoutCellMonths": len(holdout),
        "labels": {"fixtureOrReal": "real FIRMS archive data", "status": "retrospective transfer benchmark of a frozen model; not an operational validation and not evidence for domains outside the table"},
        "limits": [
            "the holdout is one partial year (February to December 2012, the first full VIIRS S-NPP months) and cannot support claims about later years",
            "the same sensor pair, quality policy and 1-degree cell-month unit apply; a different satellite set needs a new configuration",
            "named regions are boxes of 1-degree cells chosen before the results were seen; they are examples, not a sample of the globe",
            "the retrain reference shows how much a domain-specific multiplier would differ; it is not part of the published method",
        ],
        **body,
    }
    digest = hashlib.sha256(json.dumps(content, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()
    return {"id": f"transfer-{digest[:16]}", "contentSha256": digest, **content}


def summary_lines(result):
    lines = []
    for domain, entry in sorted(result["domains"].items()):
        hold = entry["holdout"]
        lines.append(f"{domain}: status={entry['status']} holdout={hold['verdict']} cells={hold['cellMonths']} reduction={hold.get('maeReduction')} bias={hold.get('frozen', {}).get('aggregateRelativeBias')}")
    for name, entry in result["regions"].items():
        lines.append(f"region {name}: holdout={entry['holdout']['verdict']} test={entry['test']['verdict']} testBias={entry['test'].get('frozen', {}).get('aggregateRelativeBias')}")
    return lines


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--models", default=Path(__file__).resolve().parent / "models", type=Path)
    parser.add_argument("--pairs", default=ROOT / "data" / "processed" / "harmonization", type=Path)
    args = parser.parse_args(argv)
    try:
        result = build(args.models, args.pairs, args.pairs)
    except (ValueError, OSError, KeyError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    path = args.models / f"transfer-{config.CONFIG_HASH[:12]}.json"
    path.write_text(json.dumps(result, indent=1) + "\n", encoding="utf-8")
    print(result["id"], path)
    print("\n".join(summary_lines(result)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
