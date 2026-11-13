"""Build a bounded research bundle from a versioned local detection store."""
import hashlib
import json
import sys
from pathlib import Path

from area_query import Polygon, months_between, period_minutes
from research_adapter import build_result, daily_page, detections_page, load_default_harmonization


def fingerprint(root):
    root = Path(root)
    if not root.is_dir():
        raise ValueError("MISSING_DATASET")
    digest = hashlib.sha256()
    for path in sorted(p for p in root.rglob("*") if p.is_file() and (p.suffix == ".pcd" or p.name == "manifest.jsonl")):
        digest.update(path.relative_to(root).as_posix().encode() + b"\0")
        with path.open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(block)
    return "sha256:" + digest.hexdigest()


def produce(root, run):
    data = run["input"]
    if fingerprint(root) != data["dataset"]["fingerprint"]:
        raise ValueError("DATASET_CHANGED")
    area = data["area"]
    polygon = Polygon(area["geometry"])
    period, comparison = data["period"], data["comparisonPeriod"]
    sources = tuple(data["dataset"]["sources"])
    model, baseline = load_default_harmonization(data["baseline"]["windowYears"]) if data["dataset"].get("producerVersion") == "research-harmonized-1" else (None, None)
    built = build_result(root, polygon, period["start"], period["end"], comparison, sources=sources,
                         name=area["name"], area_id=area["id"], workspace_id=run["workspaceId"],
                         job_id=run["id"], result_id=run["id"], window_years=data["baseline"]["windowYears"], model=model, baseline=baseline)
    built["result"]["area"] = area
    # The server's canonical hash identifies the submitted area in its own namespace.
    built["manifest"]["serverGeometryHash"] = area["geometryHash"]
    days, pages = [], []
    for role, selected, counts in (("primary", period, built["counts"]), ("comparison", comparison, built["comparisonCounts"])):
        if selected is None:
            continue
        for month in months_between(*period_minutes(selected["start"], selected["end"])):
            estimates = built["harmonized"] if role == "primary" else built["comparisonHarmonized"]
            days.append(daily_page(counts, run["id"], month, role, harmonized=estimates.get(month)))
        cursor = None
        while True:
            page = detections_page(root, polygon, run["id"], selected["start"], selected["end"], sources, role, cursor)
            pages.append(page)
            if sum(len(item["observations"]) for item in pages) > 100000:
                raise ValueError("CAPACITY_LIMIT")
            cursor = page["nextCursor"]
            if cursor is None:
                break
    if fingerprint(root) != data["dataset"]["fingerprint"]:
        raise ValueError("DATASET_CHANGED")
    return {"result": built["result"], "manifest": built["manifest"], "days": days, "detections": pages}


if __name__ == "__main__":
    try:
        request = json.load(sys.stdin)
        result = fingerprint(request["root"]) if request.get("action") == "fingerprint" else produce(request["root"], request["run"])
        json.dump(result, sys.stdout, allow_nan=False)
    except Exception:
        print("RESEARCH_WORKER_FAILED", file=sys.stderr)
        sys.exit(1)
