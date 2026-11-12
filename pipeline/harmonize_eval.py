"""Evaluate raw alignment, regressions and EQM on the same paired sample (R2-P1-N2).

Usage:
  python pipeline/harmonize_eval.py
Fits on train, selects on validation, scores test once, and writes the decision with
per-domain, per-season and per-count-bin results. A domain is validated only when the
frozen decision rule in harmonize_config.py holds; nothing is tuned on test.
"""

import argparse
import hashlib
import json
import sys
from collections import defaultdict
from pathlib import Path

import harmonize_config as config
from harmonize import fit as eqm_fit
from harmonize import transform as eqm_transform
from harmonize_pairs import ROOT, read_pairs

EVALUATION_VERSION = "evaluation-1"
MINIMUM_TRAIN_ROWS_PER_DOMAIN = 200


def split_rows(rows):
    parts = {"train": [], "validation": [], "test": []}
    for row in rows:
        parts[row[1]].append(row)
    return parts


def fit_ratio(rows):
    numerator = sum(r[5] * r[4] for r in rows)
    denominator = sum(r[5] * r[5] for r in rows)
    return numerator / denominator if denominator > 0 else None


def fit_affine(rows):
    n = len(rows)
    mean_x = sum(r[5] for r in rows) / n
    mean_y = sum(r[4] for r in rows) / n
    variance = sum((r[5] - mean_x) ** 2 for r in rows)
    slope = sum((r[5] - mean_x) * (r[4] - mean_y) for r in rows) / variance
    return mean_y - slope * mean_x, slope


def fit_models(train):
    models = {"raw_alignment": {}, "ratio_global": {"ratio": fit_ratio(train)}}
    by_domain = defaultdict(list)
    for row in train:
        by_domain[row[2]].append(row)
    models["ratio_domain"] = {
        "ratios": {d: fit_ratio(items) for d, items in sorted(by_domain.items()) if len(items) >= MINIMUM_TRAIN_ROWS_PER_DOMAIN and d != config.OTHER_DOMAIN},
    }
    intercept, slope = fit_affine(train)
    models["affine_global"] = {"intercept": intercept, "slope": slope}
    eqm = eqm_fit([r[5] for r in train], [r[4] for r in train])
    models["eqm_global"] = {"eqm": eqm}
    models["support"] = {"maxViirs": max(r[5] for r in train), "positiveRows": sum(r[5] > 0 for r in train)}
    return models


def predict(name, models, row):
    """MODIS-scale estimate for one cell-month, or None when the candidate has no model for the domain."""
    x = row[5]
    if name == "raw_alignment":
        return float(x)
    if name == "ratio_global":
        return models["ratio_global"]["ratio"] * x
    if name == "ratio_domain":
        ratio = models["ratio_domain"]["ratios"].get(row[2])
        return None if ratio is None else ratio * x
    if name == "affine_global":
        return max(0.0, models["affine_global"]["intercept"] + models["affine_global"]["slope"] * x)
    if name == "eqm_global":
        return eqm_transform(models["eqm_global"]["eqm"], float(x))["value"]
    raise ValueError(name)


def score(name, models, rows):
    """MAE, bias and domain-month aggregate bias on the rows a candidate can predict."""
    absolute = signed = covered = 0
    observed_total = 0
    sums = defaultdict(lambda: [0.0, 0.0])
    for row in rows:
        value = predict(name, models, row)
        if value is None:
            continue
        covered += 1
        error = value - row[4]
        absolute += abs(error)
        signed += error
        observed_total += row[4]
        bucket = sums[(row[2], row[0])]
        bucket[0] += value
        bucket[1] += row[4]
    if covered == 0:
        return {"cellMonths": 0, "skipped": len(rows), "mae": None, "bias": None, "relativeBias": None, "aggregateMae": None, "aggregateRelativeBias": None, "observedMean": None}
    aggregate_error = sum(abs(p - o) for p, o in sums.values()) / len(sums)
    aggregate_observed = sum(o for _, o in sums.values())
    return {
        "cellMonths": covered,
        "skipped": len(rows) - covered,
        "mae": absolute / covered,
        "bias": signed / covered,
        "relativeBias": signed / observed_total if observed_total else None,
        "aggregateMae": aggregate_error,
        "aggregateRelativeBias": sum(p - o for p, o in sums.values()) / aggregate_observed if aggregate_observed else None,
        "observedMean": observed_total / covered,
    }


def bin_label(low, high):
    return f"{low}" if low == high else f"{low}+" if high is None else f"{low}-{high}"


def breakdowns(name, models, rows):
    by_bin = defaultdict(list)
    by_season = defaultdict(list)
    for row in rows:
        for low, high in config.COUNT_BINS:
            if row[5] >= low and (high is None or row[5] <= high):
                by_bin[bin_label(low, high)].append(row)
                break
        month = int(row[0][5:])
        season = next(s for s, months in config.SEASONS.items() if month in months)
        by_season[season].append(row)
    return {
        "byViirsCountBin": {label: score(name, models, items) for label, items in sorted(by_bin.items())},
        "bySeason": {label: score(name, models, items) for label, items in sorted(by_season.items())},
    }


def outside_support(models, rows):
    positive = [r for r in rows if r[5] > 0]
    outside = sum(r[5] > models["support"]["maxViirs"] for r in positive)
    return {"positiveRows": len(positive), "aboveTrainMax": outside, "share": outside / len(positive) if positive else None}


def passes(candidate, raw, rule):
    """Decision-rule checks for one candidate against raw alignment on the same rows."""
    checks = {}
    checks["enoughCellMonths"] = candidate["cellMonths"] >= rule["minimumTestCellMonths"]
    if candidate["mae"] is None or raw["mae"] in (None, 0):
        checks["maeReduction"] = False
        checks["reduction"] = None
    else:
        reduction = (raw["mae"] - candidate["mae"]) / raw["mae"]
        checks["reduction"] = reduction
        checks["maeReduction"] = reduction >= rule["minimumMaeReductionVersusRaw"]
    relative = candidate["aggregateRelativeBias"]
    checks["aggregateBias"] = relative is not None and abs(relative) <= rule["maximumAbsoluteRelativeBiasAggregated"]
    return checks


def refit_without(domain, train):
    pooled = fit_ratio([r for r in train if r[2] != domain])
    return {"ratio_global": {"ratio": pooled}}


def evaluate(rows):
    parts = split_rows(rows)
    models = fit_models(parts["train"])
    rule = config.DECISION_RULE
    validation = {name: score(name, models, parts["validation"]) for name in config.CANDIDATES}
    eligible = [n for n in config.ADDITIVE_CANDIDATES if validation[n]["mae"] is not None and validation[n]["skipped"] == 0]
    selected = min(eligible, key=lambda n: validation[n]["mae"])
    test = {name: {"overall": score(name, models, parts["test"]), **breakdowns(name, models, parts["test"])} for name in config.CANDIDATES}
    domains = sorted({r[2] for r in parts["test"]})
    per_domain = {}
    for domain in domains:
        domain_rows = [r for r in parts["test"] if r[2] == domain]
        raw = score("raw_alignment", models, domain_rows)
        entry = {"testCellMonths": len(domain_rows), "candidates": {name: score(name, models, domain_rows) for name in config.CANDIDATES}}
        entry["support"] = outside_support(models, domain_rows)
        chosen = entry["candidates"][selected]
        entry["selectedChecks"] = passes(chosen, raw, rule)
        if domain == config.OTHER_DOMAIN:
            entry["transfer"] = None
            entry["validated"] = False
            entry["reason"] = "domain 'other' is never validated"
        else:
            refit = refit_without(domain, parts["train"])
            transfer = score("ratio_global", refit, domain_rows)
            entry["transfer"] = {"modelFamily": "ratio_global without the domain", "score": transfer, "checks": passes(transfer, raw, rule)}
            share = entry["support"]["share"]
            checks = entry["selectedChecks"]
            transfer_ok = entry["transfer"]["checks"]["maeReduction"] and entry["transfer"]["checks"]["aggregateBias"]
            support_ok = share is not None and share <= rule["outsideSupportMaximumShare"]
            entry["validated"] = bool(checks["enoughCellMonths"] and checks["maeReduction"] and checks["aggregateBias"] and transfer_ok and support_ok)
            failed = [label for label, ok in (("cell-months", checks["enoughCellMonths"]), ("MAE reduction", checks["maeReduction"]), ("aggregate bias", checks["aggregateBias"]), ("transfer", transfer_ok), ("support", support_ok)) if not ok]
            entry["reason"] = "meets every threshold" if entry["validated"] else "fails: " + ", ".join(failed)
        per_domain[domain] = entry
    decisions = {}
    for name in config.CANDIDATES:
        additive = name in config.ADDITIVE_CANDIDATES
        if name == "raw_alignment":
            decisions[name] = {"decision": "baseline", "reason": "comparison baseline, not a method"}
        elif not additive:
            decisions[name] = {"decision": "rejected-for-publication", "reason": "not additive: cannot be applied to clipped polygons or allocated to days; reported for comparison", "validationMae": validation[name]["mae"]}
        elif name == selected:
            decisions[name] = {"decision": "selected", "reason": "lowest validation MAE among additive candidates", "validationMae": validation[name]["mae"]}
        else:
            decisions[name] = {"decision": "not-selected", "reason": "higher validation MAE than the selected additive candidate", "validationMae": validation[name]["mae"]}
    validated = sorted(d for d, e in per_domain.items() if e["validated"])
    return {
        "models": {k: v for k, v in models.items() if k != "eqm_global"},
        "selected": selected,
        "validation": validation,
        "test": test,
        "domains": per_domain,
        "decisions": decisions,
        "validatedDomains": validated,
        "unvalidatedDomains": sorted(d for d in per_domain if d not in validated),
        "trainRows": len(parts["train"]),
        "validationRows": len(parts["validation"]),
        "testRows": len(parts["test"]),
    }


def build(pairs_path, manifest_path):
    rows = read_pairs(pairs_path)
    manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
    body = evaluate(rows)
    content = {
        "schema": EVALUATION_VERSION,
        "configHash": config.CONFIG_HASH,
        "pairsSha256": manifest["pairsSha256"],
        "decisionRule": config.DECISION_RULE,
        "selectionRule": config.SELECTION_RULE,
        "labels": {"fixtureOrReal": "real FIRMS archive data", "status": "retrospective evaluation; not an operational validation of future months"},
        "limits": [
            "pairs list cells with at least one accepted detection in either source; cells empty in both are not enumerated",
            "cell-month units are 1 degree; polygon estimates apply the multiplier to counts inside the polygon, which is exact only because the selected method is additive",
            "the evaluation compares VIIRS-derived estimates to MODIS counts, not to fire occurrence on the ground",
            "a multiplier fitted for S-NPP plus Terra/Aqua does not transfer to a different satellite set",
        ],
        **body,
    }
    digest = hashlib.sha256(json.dumps(content, sort_keys=True, separators=(",", ":"), default=str).encode()).hexdigest()
    return {"id": f"evaluation-{digest[:16]}", "contentSha256": digest, **content}


def model_payload(evaluation):
    selected = evaluation["selected"]
    models = evaluation["models"]
    return {
        "schema": "harmonization-model-1",
        "evaluationId": evaluation["id"],
        "configHash": evaluation["configHash"],
        "family": selected,
        "ratio": models["ratio_global"]["ratio"] if selected == "ratio_global" else None,
        "ratios": models["ratio_domain"]["ratios"] if selected == "ratio_domain" else None,
        "validatedDomains": evaluation["validatedDomains"],
        "unvalidatedDomains": evaluation["unvalidatedDomains"],
        "pairsSha256": evaluation["pairsSha256"],
        "split": config.SPLIT,
        "decisionRuleVersion": evaluation["decisionRule"]["version"],
        "testMae": evaluation["test"][selected]["overall"]["mae"],
        "testRawAlignmentMae": evaluation["test"]["raw_alignment"]["overall"]["mae"],
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dir", default=ROOT / "data" / "processed" / "harmonization", type=Path)
    args = parser.parse_args(argv)
    prefix = config.CONFIG_HASH[:12]
    pairs, manifest = args.dir / f"pairs-{prefix}.csv.gz", args.dir / f"pairs-{prefix}.manifest.json"
    if not pairs.exists():
        print("error: run harmonize_pairs.py --pairs first", file=sys.stderr)
        return 1
    evaluation = build(pairs, manifest)
    (args.dir / f"evaluation-{prefix}.json").write_text(json.dumps(evaluation, indent=1, default=str) + "\n", encoding="utf-8")
    (args.dir / f"model-{prefix}.json").write_text(json.dumps(model_payload(evaluation), indent=1) + "\n", encoding="utf-8")
    print(f"selected {evaluation['selected']} (validation MAE {evaluation['validation'][evaluation['selected']]['mae']:.3f})")
    for name in config.CANDIDATES:
        overall = evaluation["test"][name]["overall"]
        print(f"  test {name:14s} MAE {overall['mae']:.3f} bias {overall['bias']:+.3f} aggregate rel.bias {overall['aggregateRelativeBias']:+.3f}" if overall["mae"] is not None else f"  test {name}: no estimate")
    for domain, entry in evaluation["domains"].items():
        print(f"  {domain:36s} {'VALID' if entry['validated'] else 'no':5s} {entry['reason']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
