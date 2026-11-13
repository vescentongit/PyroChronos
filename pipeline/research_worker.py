"""Build a bounded research bundle from a versioned local detection store."""
import json
import sys

from area_query import Polygon, months_between, period_minutes
from research_adapter import build_result, daily_page, detections_page
from research_p1_producer import (
    describe_producer,
    fingerprint,
    frozen_harmonization,
    publication_manifest,
)


def produce(root, run):
    data = run["input"]
    p1 = "producer" in data
    if p1:
        config = data["producer"]
        data = {**data["request"], "area": data["area"], "dataset": config}
        model, baseline = frozen_harmonization(config, data["baseline"]["windowYears"])
    else:
        model, baseline = None, None
    if fingerprint(root) != data["dataset"]["fingerprint"]:
        raise ValueError("DATASET_CHANGED")
    area = data["area"]
    polygon = Polygon(area["geometry"])
    period, comparison = data["period"], data["comparisonPeriod"]
    sources = tuple(data["dataset"]["sources"])
    built = build_result(root, polygon, period["start"], period["end"], comparison, sources=sources,
                         name=area["name"], area_id=area["id"], workspace_id=run["workspaceId"],
                         job_id=run["id"], result_id=run["id"], window_years=data["baseline"]["windowYears"], model=model, baseline=baseline)
    built["result"]["area"] = area
    # The server's canonical hash identifies the submitted area in its own namespace.
    if not p1:
        built["manifest"]["serverGeometryHash"] = area["geometryHash"]
    days, pages = [], []
    for role, selected, counts in (("primary", period, built["counts"]), ("comparison", comparison, built["comparisonCounts"])):
        if selected is None:
            continue
        for month in months_between(*period_minutes(selected["start"], selected["end"])):
            estimates = built["harmonized"] if role == "primary" else built["comparisonHarmonized"]
            days.append(daily_page(counts, run["id"], month, role, estimates.get(month)))
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
    if p1:
        frozen = run["input"]
        result = built["result"]
        if result["dataVersion"] != frozen["versions"]["dataVersion"] or result["method"]["version"] != frozen["versions"]["modelVersion"]:
            raise ValueError("CONFIGURATION_CHANGED")
        result["mode"] = config["mode"]
        return {"result": result, "manifest": publication_manifest(built, frozen, run["id"], run["workspaceId"]), "days": days, "detections": pages}
    return {"result": built["result"], "manifest": built["manifest"], "days": days, "detections": pages}


if __name__ == "__main__":
    try:
        request = json.load(sys.stdin)
        if request.get("action") == "describe":
            result = describe_producer(request["root"], models_dir=request.get("modelsDir"), mode=request.get("mode", "research"))
        else:
            result = fingerprint(request["root"]) if request.get("action") == "fingerprint" else produce(request["root"], request["run"])
        json.dump(result, sys.stdout, allow_nan=False)
    except Exception:
        print("RESEARCH_WORKER_FAILED", file=sys.stderr)
        sys.exit(1)
