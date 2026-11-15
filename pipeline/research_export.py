"""CSV exports for the same polygon and period as a research-2 result (R2-P1-N4).

raw-hotspots-csv: original detections inside the real polygon, one row per detection.
harmonized-aggregates-csv: one row per calendar month and one per period summary, with raw counts
per source, the MODIS-scale estimate, baseline and method metadata. Rows are never repeated to
match an estimate. Text cells that a spreadsheet could read as a formula are neutralised.
"""

import csv
import unicodedata
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
    if isinstance(value, str):
        index = 0
        while index < len(value) and (value[index].isspace() or ord(value[index]) < 32
                                      or ord(value[index]) == 127 or unicodedata.category(value[index]) == "Cf"):
            index += 1
        if (value[index:].startswith(FORMULA_PREFIXES)
                or any(char in "\t\r" for char in value[:index])):
            return "'" + value
    return value


def raw_rows(observations):
    rows = ([item["id"], item["sourceId"], item["observedAt"], *item["coordinates"],
             item["confidence"], item["frpMw"], item.get("satellite")] for item in observations)
    return RAW_COLUMNS, rows


def write_csv(handle, header, rows):
    writer = csv.writer(handle, lineterminator="\n")
    writer.writerow([cell(value) for value in header])
    count = 0
    for row in rows:
        writer.writerow([cell(value) for value in row])
        count += 1
    return count


def write_raw_hotspots(store_dir, polygon, start, end, path, sources=DEFAULT_SOURCES):
    """Stream original detections; returns the number of rows written."""
    keep = accepts(QUALITY_POLICY)
    observations = (
        {"id": item["id"], "sourceId": item["source"], "observedAt": item["observedAt"],
         "coordinates": [item["lon"], item["lat"]], "confidence": item["confidenceRaw"],
         "frpMw": item["frpMw"], "satellite": item["satellite"]}
        for source_id in sources for item in query(store_dir, source_id, polygon, start, end) if keep(item)
    )
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        return write_csv(handle, *raw_rows(observations))


def aggregate_rows(result, period_role=None):
    if period_role not in (None, "primary", "comparison"):
        raise ValueError("INVALID_PERIOD_ROLE")
    if period_role == "comparison" and result["comparison"] is None:
        raise ValueError("INVALID_PERIOD_ROLE")
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
        if summary is None or (period_role is not None and role != period_role):
            continue
        metric = summary["metric"]
        rows.append(["period", *common, role, "", summary["period"]["start"], summary["period"]["end"], summary["days"], metric["status"], "", *[metric["rawCountsBySource"].get(s) for s in sources], metric["rawCount"], metric["harmonizedCount"], *tail, "", "", "", "", "", "", ""])
    for entry in result["months"] if period_role != "comparison" else []:
        metric, anomaly = entry["metric"], entry["anomaly"]
        rows.append([
            "month", *common, "primary", entry["month"], "", "", "", metric["status"], entry["isPartialPeriod"], *[metric["rawCountsBySource"].get(s) for s in sources], metric["rawCount"], metric["harmonizedCount"], *tail,
            anomaly["status"], " ".join(str(y) for y in anomaly["referenceYears"]), anomaly["baselineStatistic"], anomaly["baselineValue"], anomaly["delta"], anomaly["scoreKind"], anomaly["score"],
        ])
    return header, rows


def write_aggregates(result, path, period_role=None):
    header, rows = aggregate_rows(result, period_role)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        return write_csv(handle, header, rows)
