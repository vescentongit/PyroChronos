"""Recompute the harmonization evaluation and transfer benchmark and compare them with the committed artifacts (R2-P2-N4).

Usage:
  python pipeline/reproduce_check.py
Needs the local pairs table (build it with harmonize_pairs.py --counts --pairs after the archives are
downloaded). Exit code 0 only when every check matches; a mismatch means the data, code or configuration differs.
"""

import argparse
import hashlib
import json
import sys
from pathlib import Path

import harmonize_config as config
import harmonize_eval as evaluation
import harmonize_transfer as transfer
from harmonize_pairs import ROOT


def sha256_of(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def run(models_dir, pairs_dir):
    prefix = config.CONFIG_HASH[:12]
    models_dir, pairs_dir = Path(models_dir), Path(pairs_dir)
    pairs = pairs_dir / f"pairs-{prefix}.csv.gz"
    manifest_path = models_dir / f"pairs-{prefix}.manifest.json"
    checks = []

    def record(name, ok, detail=""):
        checks.append({"check": name, "ok": bool(ok), "detail": detail})

    manifest = load(manifest_path)
    record("config hash matches the pairs manifest", manifest["config"]["hash"] == config.CONFIG_HASH, config.CONFIG_HASH[:12])
    if not pairs.exists():
        record("pairs table present", False, str(pairs))
        return checks
    record("pairs table sha256 matches manifest", sha256_of(pairs) == manifest["pairsSha256"], manifest["pairsSha256"][:12])
    committed = load(models_dir / f"evaluation-{prefix}.json")
    rebuilt = evaluation.build(pairs, manifest_path)
    record("evaluation recomputes to the committed id", rebuilt["id"] == committed["id"], f"{rebuilt['id']} vs {committed['id']}")
    model = load(models_dir / f"model-{prefix}.json")
    record("model references the committed evaluation", model["evaluationId"] == committed["id"] and model["pairsSha256"] == committed["pairsSha256"])
    record("model ratio equals the evaluation ratio", model["ratio"] == committed["models"]["ratio_global"]["ratio"])
    if (models_dir / f"transfer-{prefix}.json").exists():
        recorded = load(models_dir / f"transfer-{prefix}.json")
        counts_ready = all((pairs_dir / "cells" / f"{source}-2012.json.gz").exists() for source in (config.REFERENCE_SOURCE, config.HARMONIZED_SOURCE))
        if counts_ready:
            rebuilt_transfer = transfer.build(models_dir, pairs_dir, pairs_dir)
            record("transfer benchmark recomputes to the committed id", rebuilt_transfer["id"] == recorded["id"], f"{rebuilt_transfer['id']} vs {recorded['id']}")
        else:
            record("2012 cell counts present for the transfer benchmark", False)
    return checks


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--models", default=Path(__file__).resolve().parent / "models", type=Path)
    parser.add_argument("--pairs", default=ROOT / "data" / "processed" / "harmonization", type=Path)
    args = parser.parse_args(argv)
    try:
        checks = run(args.models, args.pairs)
    except (ValueError, OSError, KeyError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    for item in checks:
        print(("OK   " if item["ok"] else "FAIL ") + item["check"] + (f" ({item['detail']})" if item["detail"] else ""))
    return 0 if all(item["ok"] for item in checks) else 1


if __name__ == "__main__":
    sys.exit(main())
