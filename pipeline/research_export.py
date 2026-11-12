"""CSV exports for the same polygon and period as a research-2 result (R2-P1-N4).

raw-hotspots-csv: original detections inside the real polygon, one row per detection.
harmonized-aggregates-csv: one row per calendar month and one per period summary, with raw counts
per source, the MODIS-scale estimate, baseline and method metadata. Rows are never repeated to
match an estimate. Text cells that a spreadsheet could read as a formula are neutralised.
"""

import csv
from pathlib import Path

from area_counts import DEFAULT_SOURCES, QUALITY_POLICY, accepts
from area_query import query

RAW_COLUMNS = ["id", "sourceId", "observedAt", "longitude", "latitude", "confidence", "frpMw", "satellite"]
FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def cell(value):
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str) and value.startswith(FORMULA_PREFIXES):
        return "'" + value
    return value


def write_raw_hotspots(store_dir, polygon, start, end, path, sources=DEFAULT_SOURCES):
    """Stream original detections; returns the number of rows written."""
    keep = accepts(QUALITY_POLICY)
    total = 0
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(RAW_COLUMNS)
        for source_id in sources:
            for item in query(store_dir, source_id, polygon, start, end):
                if keep(item):
                    writer.writerow([cell(v) for v in (item["id"], item["source"], item["observedAt"], item["lon"], item["lat"], item["confidenceRaw"], item["frpMw"], item["satellite"])])
                    total += 1
    return total


def aggregate_rows(result):
    sources = sorted(source["id"] for source in result["sources"])
    area, method, baseline = result["area"], result["method"], result["baseline"]
    header = [
        "rowKind", "analysisId", "areaId", "areaRevision", "geometryHash", "areaKm2", "periodRole", "month", "periodStart", "periodEnd", "days",
        "status", "isPartialPeriod", *[f"rawCount_{s}" for s in sources], "rawCount", "harmonizedCount", "unit", "referenceScale",
        "methodName", "methodVersion", "validation", "manifestId", "dataVersion", "qualityPolicyVersion",
        "baselinePolicy", "baselineWindowYears", "baselineMinimumValidYears", "anomalyStatus", "referenceYears", "baselineStatistic", "baselineValue", "delta", "scoreKind", "score",
    ]
    common = [result["id"], area["id"], area["revision"], area["geometryHash"], area["areaKm2"]]
    tail = [method["unit"], method["referenceScale"], method["name"], method["version"], method["validation"], method["manifestId"], result["dataVersion"], result["qualityPolicyVersion"], baseline["policyVersion"], baseline["windowYears"], baseline["minimumValidYears"]]
    rows = []
    for role, summary in (("primary", result["primary"]), ("comparison", result["comparison"])):
        if summary is None:
            continue
        metric = summary["metric"]
        rows.append(["period", *common, role, "", summary["period"]["start"], summary["period"]["end"], summary["days"], metric["status"], "", *[metric["rawCountsBySource"].get(s) for s in sources], metric["rawCount"], metric["harmonizedCount"], *tail, "", "", "", "", "", "", ""])
    for entry in result["months"]:
        metric, anomaly = entry["metric"], entry["anomaly"]
        rows.append([
            "month", *common, "primary", entry["month"], "", "", "", metric["status"], entry["isPartialPeriod"], *[metric["rawCountsBySource"].get(s) for s in sources], metric["rawCount"], metric["harmonizedCount"], *tail,
            anomaly["status"], " ".join(str(y) for y in anomaly["referenceYears"]), anomaly["baselineStatistic"], anomaly["baselineValue"], anomaly["delta"], anomaly["scoreKind"], anomaly["score"],
        ])
    return header, rows


def write_aggregates(result, path):
    header, rows = aggregate_rows(result)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(header)
        for row in rows:
            writer.writerow([cell(v) for v in row])
    return len(rows)
