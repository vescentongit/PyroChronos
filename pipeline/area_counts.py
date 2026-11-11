"""Raw detection counts per source for a polygon, with explicit coverage and a reproducible manifest.

A count is a number of original detections accepted by the quality policy; it is not a number of
fire events, cell-days or burned area. Counts of different sources are never summed into a
harmonized value here. Months or days without archive coverage are null/no_data, never zero.
"""

import hashlib
import json
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

from area_query import Polygon, months_between, period_minutes, query
from detection_store import FORMAT_VERSION, minute_to_iso
from firms_catalog import get_source

QUALITY_POLICY = {
    "version": "quality-policy-1",
    "fireTypes": ["vegetation", "unknown"],
    "confidenceClasses": ["nominal", "high"],
    "note": "Archive type 0 (vegetation) and feeds without a type column are counted; low confidence, volcano, static and offshore detections are excluded and reported.",
}
SATELLITE_CONFIG_VERSION = "satellite-config-1"
DEDUP_RULE = "one record per source, latitude/longitude (1e-5 deg), acquisition minute and satellite; duplicates removed when the archive is stored"
COUNT_DEFINITION = "detections accepted by the quality policy within the polygon and inclusive UTC period; not cell-days, fire events or burned area"
OVERLAP_RULE = "sources are counted separately; an added satellite is not treated as an equivalent series without a validated calibration"
DEFAULT_SOURCES = ("MODIS_SP", "VIIRS_SNPP_SP")


def accepts(policy):
    types, classes = set(policy["fireTypes"]), set(policy["confidenceClasses"])
    return lambda item: item["fireType"] in types and item["confidenceClass"] in classes


def source_coverage(store_dir, source_id):
    """Latest manifest entry per year plus its first/last observed UTC day."""
    manifest = Path(store_dir) / source_id / "manifest.jsonl"
    years = {}
    if manifest.exists():
        for line in manifest.read_text(encoding="utf-8").splitlines():
            entry = json.loads(line)
            if entry.get("detections_format") == FORMAT_VERSION:
                years[entry["year"]] = entry
    return dict(sorted(years.items()))


def month_status(coverage, month):
    """observed: the year archive spans the whole month; partial: only part of it; no_data: none of it.

    Coverage comes from the archive's first/last observed day, so a covered month that has no
    detection inside a polygon (or even globally) is observed with a count of zero, not no_data.
    """
    entry = coverage.get(int(month[:4]))
    if entry is None or not entry.get("first_observed"):
        return "no_data"
    first = date.fromisoformat(entry["first_observed"][:10])
    last = date.fromisoformat(entry["last_observed"][:10])
    start = date.fromisoformat(month + "-01")
    end = (start.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    if last < start or first > end:
        return "no_data"
    return "observed" if first <= start and last >= end else "partial"


def month_satellites(coverage, month):
    entry = coverage.get(int(month[:4]))
    if entry is None:
        return []
    return next((m["satellites"] for m in entry["months"] if m["month"] == month), [])


def count_source(store_dir, source_id, polygon, start, end, policy=QUALITY_POLICY):
    """Counts per day and month for one source; also reports exclusions and coverage."""
    coverage = source_coverage(store_dir, source_id)
    keep = accepts(policy)
    start_minute, end_minute = period_minutes(start, end)
    days, excluded = defaultdict(int), {"lowConfidence": 0, "nonVegetationType": 0}
    for item in query(store_dir, source_id, polygon, start, end):
        if keep(item):
            days[minute_to_iso(item["minute"])[:10]] += 1
        elif item["fireType"] not in policy["fireTypes"]:
            excluded["nonVegetationType"] += 1
        else:
            excluded["lowConfidence"] += 1
    months = {}
    for month in months_between(start_minute, end_minute):
        status = month_status(coverage, month)
        total = None if status == "no_data" else sum(n for day, n in days.items() if day.startswith(month))
        months[month] = {"status": status, "count": total, "satellites": month_satellites(coverage, month)}
    return {"source": source_id, "months": months, "days": dict(sorted(days.items())), "excluded": excluded, "coverage": coverage}


def archive_checksum(coverage, months):
    parts = sorted(f"{y}:{e['sha256']}" for y, e in coverage.items() if any(m.startswith(str(y)) for m in months))
    return "sha256:" + hashlib.sha256("|".join(parts).encode()).hexdigest() if parts else None


def count_area(store_dir, polygon, start, end, sources=DEFAULT_SOURCES, policy=QUALITY_POLICY):
    for source_id in sources:
        get_source(source_id)
    per_source = {source_id: count_source(store_dir, source_id, polygon, start, end, policy) for source_id in sources}
    return {"period": {"start": start, "end": end}, "sources": per_source, "policy": policy}


def build_manifest(result, polygon, generated_at):
    """Reproducible manifest of the rules and archive versions behind a count result."""
    start_minute, end_minute = period_minutes(result["period"]["start"], result["period"]["end"])
    months = months_between(start_minute, end_minute)
    sources = {}
    for source_id, data in result["sources"].items():
        source = get_source(source_id)
        coverage = data["coverage"]
        years = {y: e for y, e in coverage.items() if any(m.startswith(str(y)) for m in months)}
        sources[source_id] = {
            "sensor": source.sensor,
            "processing": source.processing,
            "nominalResolutionM": source.nominal_resolution_m,
            "archiveYears": [
                {"year": y, "sha256": e["sha256"], "firstObserved": e["first_observed"], "lastObserved": e["last_observed"], "detections": e["detections"]}
                for y, e in years.items()
            ],
            "archiveChecksum": archive_checksum(coverage, months),
            "monthsNoData": [m for m, v in data["months"].items() if v["status"] == "no_data"],
            "monthsPartial": [m for m, v in data["months"].items() if v["status"] == "partial"],
            "satellitesByMonth": {m: v["satellites"] for m, v in data["months"].items() if v["satellites"]},
            "excluded": data["excluded"],
            "rawCount": None if all(v["count"] is None for v in data["months"].values()) else sum(v["count"] or 0 for v in data["months"].values()),
        }
    content = {
        "schema": "analysis-manifest-1",
        "storeFormat": FORMAT_VERSION,
        "satelliteConfigVersion": SATELLITE_CONFIG_VERSION,
        "qualityPolicy": result["policy"],
        "countDefinition": COUNT_DEFINITION,
        "dedupRule": DEDUP_RULE,
        "overlapRule": OVERLAP_RULE,
        "geometryHash": polygon.geometry_hash(),
        "areaKm2": round(polygon.area_km2, 3),
        "period": result["period"],
        "sources": sources,
    }
    digest = hashlib.sha256(json.dumps(content, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return {"id": f"manifest-{digest[:16]}", "contentSha256": digest, "generatedAt": generated_at, **content}
