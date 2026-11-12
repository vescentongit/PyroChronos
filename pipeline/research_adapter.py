"""Producer adapter: original-detection store -> research-2 payloads (result, daily page, detections page).

Usage:
  python pipeline/research_adapter.py --area kalteng --start 2019-08-01 --end 2019-10-31 --out data/processed/research
  python pipeline/research_adapter.py --polygon area.json --start 2015-06-01 --end 2015-11-30 --comparison-start 2019-06-01 --comparison-end 2019-11-30

With the evaluated model (data/processed/harmonization) a MODIS-scale estimate is published only for
polygons wholly inside validated domains; otherwise, or with --raw-only, harmonizedCount is null,
metric status is method_unsupported (or partial/no_data), anomalies are method_unsupported and
method.validation is "unsupported". Ids (area, workspace, job, analysis) are local placeholders for
the persistence layer to replace.
"""

import argparse
import base64
import hashlib
import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from area_counts import (
    DEFAULT_SOURCES,
    QUALITY_POLICY,
    accepts,
    archive_checksum,
    build_manifest,
    count_area,
    source_coverage,
)
from area_query import Polygon, months_between, period_minutes, query
from detection_store import minute_to_iso
import harmonize_config as config
from research_export import write_aggregates, write_raw_hotspots
from reference_baseline import anomaly as assess_anomaly
from reference_baseline import harmonized_window, load_model, reference_values, support
from firms_catalog import CATALOG_VERSION, FEATURED_REGIONS, get_source, parse_bbox

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = "research-2"
MAX_PAGE = 1000
BASELINE_POLICY = "reference-policy-unevaluated-1"
PRODUCTS = {
    "MODIS": "FIRMS MODIS Collection 6.1 yearly archive",
    "VIIRS": "FIRMS VIIRS 375 m yearly archive",
}


def polygon_from_area(area):
    if area in FEATURED_REGIONS:
        west, south, east, north = FEATURED_REGIONS[area]
    else:
        west, south, east, north = parse_bbox(area)
    if west > east:
        east += 360
    shift = lambda lon: lon - 360 if lon > 180 else lon
    ring = [[shift(west), south], [shift(east), south], [shift(east), north], [shift(west), north], [shift(west), south]]
    return Polygon({"type": "Polygon", "coordinates": [ring]})


def iso_now(now=None):
    return (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ")


def days_inclusive(start, end):
    return (date.fromisoformat(end) - date.fromisoformat(start)).days + 1


def _metric(per_source, harmonized=None, supported=False):
    """per_source: {source: (count|None, status)} -> metric dict; harmonized is the MODIS-scale estimate or None."""
    counts = {sid: count for sid, (count, _) in per_source.items()}
    statuses = [status for _, status in per_source.values()]
    available = [n for n in counts.values() if n is not None]
    raw = sum(available) if available else None
    if not available:
        status, harmonized = "no_data", None
    elif harmonized is not None:
        status = "available"
    elif supported or any(s != "observed" for s in statuses):
        status = "partial"
    else:
        status = "method_unsupported"
    return {"rawCount": raw, "harmonizedCount": harmonized, "rawCountsBySource": counts, "status": status}


def _anomaly(metric):
    status = "insufficient_data" if metric["status"] == "no_data" else "method_unsupported"
    return {"status": status, "referenceYears": [], "baselineStatistic": None, "baselineValue": None, "delta": None, "scoreKind": None, "score": None}


def _summary(period, counts, harmonized=None, supported=False):
    months = months_between(*period_minutes(period["start"], period["end"]))
    per_source = {}
    for sid, data in counts["sources"].items():
        values = [data["months"][m] for m in months]
        known = [v["count"] for v in values if v["count"] is not None]
        if not known:
            per_source[sid] = (None, "no_data")
        else:
            statuses = {v["status"] for v in values}
            per_source[sid] = (sum(known), "observed" if statuses == {"observed"} else "partial")
    total = None
    if harmonized and all(harmonized[m]["value"] is not None for m in months):
        total = round(sum(harmonized[m]["value"] for m in months), 6)
    return {"period": period, "days": days_inclusive(period["start"], period["end"]), "metric": _metric(per_source, total, supported)}


def _harmonize_months(store_dir, polygon, model, period):
    result = {}
    for month in months_between(*period_minutes(period["start"], period["end"])):
        first, last, _ = month_window(month, period)
        value, raw, days = harmonized_window(store_dir, polygon, model, first, last)
        result[month] = {"value": None if value is None else round(value, 6), "raw": raw, "days": days, "first": first, "last": last}
    return result


def month_window(month, period):
    first = max(date.fromisoformat(period["start"]), date.fromisoformat(month + "-01"))
    nxt = (date.fromisoformat(month + "-01").replace(day=28) + timedelta(days=4)).replace(day=1)
    last = min(date.fromisoformat(period["end"]), nxt - timedelta(days=1))
    return first, last, nxt - timedelta(days=1)


def load_policy(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def load_default_harmonization(window_years=None, models_dir=None):
    """(model, baseline policy) from the committed evaluation outputs, or (None, None) when absent."""
    folder = Path(models_dir) if models_dir else Path(__file__).resolve().parent / "models"
    prefix = config.CONFIG_HASH[:12]
    model_path, policy_path = folder / f"model-{prefix}.json", folder / f"baseline-{prefix}.json"
    if not model_path.exists() or not policy_path.exists():
        return None, None
    model, policy = load_model(model_path), load_policy(policy_path)
    if window_years is not None:
        policy = {**policy, "windowYears": window_years, "minimumValidYears": min(policy["minimumValidYears"], window_years)}
    return model, policy


def _method(model, supported, domains):
    if model is None:
        return {
            "name": "raw-counts-per-source",
            "version": "1",
            "validation": "unsupported",
            "validationDomain": "No harmonization model was supplied; only original per-source detection counts are published and harmonizedCount is null.",
        }
    validated = ", ".join(model["validatedDomains"]) or "none"
    if supported:
        text = f"Validated for polygons inside these domains (evaluation {model['evaluationId']}, test MAE {model['testMae']:.2f} against {model['testRawAlignmentMae']:.2f} for uncorrected VIIRS per 1-degree cell-month, S-NPP with Terra/Aqua): {validated}. This polygon lies in {', '.join(domains)}."
        check = model.get("polygonCheck")
        if check and check.get("withinQuarter") is not None:
            text += f" Diagnostic on small test-year polygons with at least 30 MODIS detections: {check['withinQuarter'] * 100:.0f}% of {check['unitsWithReferenceAtLeast30']} polygon-years fall within 25% of native MODIS, so treat an estimate for a small area as approximate."
    else:
        text = f"Not validated for this polygon: it touches {', '.join(domains)}. Validated domains are {validated}; estimates are withheld and only original per-source counts are published."
    return {"name": "viirs-snpp-ratio-to-modis", "version": "1", "validation": "validated" if supported else "unsupported", "validationDomain": text}


def _comparison_note(primary, comparison):
    """Producer-side context for two periods: durations, per-day rates and a percent change that is null when it is undefined."""
    if comparison is None:
        return None
    note = {"primaryDays": primary["days"], "comparisonDays": comparison["days"], "sameDuration": primary["days"] == comparison["days"]}
    for key in ("rawCount", "harmonizedCount"):
        now, before = primary["metric"][key], comparison["metric"][key]
        reason = None
        if now is None or before is None:
            reason = "one of the periods has no complete value"
        elif before == 0:
            reason = "the comparison value is zero"
        note[key] = {
            "primary": now,
            "comparison": before,
            "perDayPrimary": None if now is None else round(now / primary["days"], 6),
            "perDayComparison": None if before is None else round(before / comparison["days"], 6),
            "percentChange": None if reason else round(100 * (now - before) / before, 3),
            "percentChangeReason": reason,
        }
    return note


def _harmonization_manifest(model, supported, domains, policy):
    return {
        "schema": "harmonization-manifest-1",
        "configHash": model["configHash"],
        "evaluationId": model["evaluationId"],
        "pairsSha256": model["pairsSha256"],
        "model": {"family": model["family"], "ratio": model["ratio"], "ratios": model["ratios"]},
        "split": model["split"],
        "decisionRuleVersion": model["decisionRuleVersion"],
        "validatedDomains": model["validatedDomains"],
        "unvalidatedDomains": model["unvalidatedDomains"],
        "polygonDomains": domains,
        "polygonSupported": supported,
        "referenceSource": "MODIS_SP",
        "inputSource": "VIIRS_SNPP_SP",
        "aggregation": "estimate = multiplier x accepted VIIRS detections inside the polygon; additive, so day, month, period and calendar totals agree; days are rounded to 6 decimals for display only",
        "baseline": {k: policy[k] for k in ("policyVersion", "kind", "windowYears", "minimumValidYears", "statistic", "scoreKind") if k in policy},
    }


def build_result(store_dir, polygon, start, end, comparison=None, sources=DEFAULT_SOURCES, name="Local area", area_id="area-local", workspace_id="workspace-local", job_id="job-local", result_id="analysis-local", window_years=10, now=None, model=None, baseline=None):
    now_text = iso_now(now)
    period = {"start": start, "end": end}
    counts = count_area(store_dir, polygon, start, end, sources)
    comparison_counts = count_area(store_dir, polygon, comparison["start"], comparison["end"], sources) if comparison else None
    supported, domains = support(polygon, model) if model is not None else (False, [])
    policy = baseline or {"policyVersion": BASELINE_POLICY, "windowYears": window_years, "minimumValidYears": window_years}
    window_years = policy["windowYears"]
    harmonized = _harmonize_months(store_dir, polygon, model, period) if supported else {}
    comparison_harmonized = _harmonize_months(store_dir, polygon, model, comparison) if supported and comparison else {}
    primary = _summary(period, counts, harmonized if supported else None, supported)
    comparison_summary = _summary(comparison, comparison_counts, comparison_harmonized if supported else None, supported) if comparison else None
    extra = None
    if model is not None:
        extra = _harmonization_manifest(model, supported, domains, policy)
        extra["comparisonSummary"] = _comparison_note(primary, comparison_summary)
    manifest = build_manifest(counts, polygon, now_text, comparison_counts, extra)
    months = []
    for month in months_between(*period_minutes(start, end)):
        per_source = {sid: (data["months"][month]["count"], data["months"][month]["status"]) for sid, data in counts["sources"].items()}
        value = harmonized[month]["value"] if supported else None
        metric = _metric(per_source, value, supported)
        first, last, month_last = month_window(month, period)
        partial = first.day != 1 or last != month_last or any(status == "partial" for _, status in per_source.values())
        if model is None:
            entry_anomaly = _anomaly(metric)
        else:
            values = reference_values(store_dir, polygon, model, first, last, window_years) if supported and value is not None else {}
            entry_anomaly = assess_anomaly(value, values, window_years, policy["minimumValidYears"], supported, value is not None)
        months.append({"month": month, "metric": metric, "anomaly": entry_anomaly, "isPartialPeriod": partial})
    sources_out = []
    for sid in sources:
        source = get_source(sid)
        data = counts["sources"][sid]
        selected_months = dict(data["months"])
        if comparison_counts is not None:
            selected_months.update(comparison_counts["sources"][sid]["months"])
        statuses = {v["status"] for v in selected_months.values()}
        info = manifest["sources"][sid]
        years = {year["year"]: year for year in info["archiveYears"]}
        if comparison_counts is not None:
            years.update({year["year"]: year for year in manifest["comparison"]["sources"][sid]["archiveYears"]})
        years = list(years.values())
        sources_out.append({
            "id": sid,
            "product": PRODUCTS[source.sensor],
            "version": CATALOG_VERSION,
            "processingLevel": source.processing.upper() if source.processing in ("nrt", "standard") else "STANDARD",
            "status": "unavailable" if statuses == {"no_data"} else "available" if statuses == {"observed"} else "partial",
            "observedFrom": min((y["firstObserved"] for y in years), default=None),
            "observedTo": max((y["lastObserved"] for y in years), default=None),
            "checksum": archive_checksum(data["coverage"], selected_months),
        })
    data_version = "firms-detections-" + hashlib.sha256("|".join(f"{s['id']}:{s['checksum']}" for s in sources_out).encode()).hexdigest()[:12]
    method = {**_method(model, supported, domains), "referenceScale": "MODIS-equivalent", "unit": "estimated-hotspot-detections", "manifestId": manifest["id"]}
    result = {
        "schemaVersion": SCHEMA,
        "id": result_id,
        "jobId": job_id,
        "workspaceId": workspace_id,
        "mode": "research",
        "area": {
            "schemaVersion": SCHEMA,
            "id": area_id,
            "workspaceId": workspace_id,
            "revision": 1,
            "name": name,
            "geometry": polygon.geometry,
            "geometryHash": polygon.geometry_hash(),
            "areaKm2": round(polygon.area_km2, 3),
            "createdAt": now_text,
        },
        "primary": primary,
        "comparison": comparison_summary,
        "baseline": {"kind": "rolling-same-calendar-period", "windowYears": window_years, "minimumValidYears": policy["minimumValidYears"], "policyVersion": policy["policyVersion"]},
        "method": {k: method[k] for k in ("name", "version", "referenceScale", "unit", "validation", "validationDomain", "manifestId")},
        "sources": sources_out,
        "dataVersion": data_version,
        "qualityPolicyVersion": QUALITY_POLICY["version"],
        "generatedAt": now_text,
        "publishedAt": now_text,
        "months": months,
    }
    return {"result": result, "manifest": manifest, "counts": counts, "comparisonCounts": comparison_counts, "harmonized": harmonized, "comparisonHarmonized": comparison_harmonized, "model": model, "supported": supported}


def daily_page(counts, analysis_id, month, role="primary", harmonized=None):
    days = []
    start, end = (date.fromisoformat(counts["period"][k]) for k in ("start", "end"))
    first = max(start, date.fromisoformat(month + "-01"))
    last = min(end, (first.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1))
    cursor = first
    while cursor <= last:
        text = cursor.isoformat()
        per_source = {}
        for sid, data in counts["sources"].items():
            info = data["months"][month]
            if info["status"] == "no_data":
                per_source[sid] = (None, "no_data")
            else:
                entry = data["coverage"][cursor.year]
                covered = date.fromisoformat(entry["first_observed"][:10]) <= cursor <= date.fromisoformat(entry["last_observed"][:10])
                per_source[sid] = (data["days"].get(text, 0), "observed") if covered else (None, "no_data")
        value = None
        if harmonized and harmonized["value"] is not None:
            value = round(harmonized["days"].get(text, 0.0), 6)
        metric = _metric(per_source, value, harmonized is not None)
        days.append({"date": text, "metric": metric, "anomaly": _anomaly(metric)})
        cursor += timedelta(days=1)
    return {"schemaVersion": SCHEMA, "analysisId": analysis_id, "periodRole": role, "month": month, "days": days, "nextCursor": None}


def _cursor_key(analysis_id, role, start, end, sources):
    return hashlib.sha256(f"{analysis_id}|{role}|{start}|{end}|{','.join(sources)}".encode()).hexdigest()[:16]


def detections_page(store_dir, polygon, analysis_id, start, end, sources=DEFAULT_SOURCES, role="primary", cursor=None, limit=MAX_PAGE):
    """One page of original detections, ordered by time then source; cursor is opaque and bound to the query."""
    limit = max(1, min(limit, MAX_PAGE))
    key = _cursor_key(analysis_id, role, start, end, sources)
    offset = 0
    if cursor:
        try:
            decoded = json.loads(base64.urlsafe_b64decode(cursor.encode()))
        except (ValueError, TypeError):
            raise ValueError("invalid cursor") from None
        if decoded.get("k") != key or not isinstance(decoded.get("o"), int) or decoded["o"] < 0:
            raise ValueError("cursor does not belong to this query")
        offset = decoded["o"]
    keep = accepts(QUALITY_POLICY)
    items = [item for sid in sources for item in query(store_dir, sid, polygon, start, end) if keep(item)]
    items.sort(key=lambda i: (i["minute"], i["source"], i["lat"], i["lon"]))
    page = items[offset : offset + limit]
    more = offset + limit < len(items)
    next_cursor = base64.urlsafe_b64encode(json.dumps({"k": key, "o": offset + limit}).encode()).decode() if more else None
    return {
        "schemaVersion": SCHEMA,
        "analysisId": analysis_id,
        "periodRole": role,
        "observations": [
            {"id": i["id"], "sourceId": i["source"], "observedAt": i["observedAt"], "coordinates": [i["lon"], i["lat"]], "confidence": i["confidenceRaw"], "frpMw": i["frpMw"]}
            for i in page
        ],
        "nextCursor": next_cursor,
    }


def write_json(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--area", help="kalteng, papua, or west,south,east,north")
    group.add_argument("--polygon", type=Path, help="GeoJSON Polygon geometry file")
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    parser.add_argument("--comparison-start")
    parser.add_argument("--comparison-end")
    parser.add_argument("--store", default=ROOT / "data" / "processed" / "detections", type=Path)
    parser.add_argument("--out", default=ROOT / "data" / "processed" / "research", type=Path)
    parser.add_argument("--harmonization", default=Path(__file__).resolve().parent / "models", type=Path)
    parser.add_argument("--export", action="store_true", help="also write raw-hotspots.csv and harmonized-aggregates.csv")
    parser.add_argument("--raw-only", action="store_true", help="publish original counts only, without the harmonization model")
    args = parser.parse_args(argv)
    try:
        model = baseline = None
        if not args.raw_only:
            prefix = config.CONFIG_HASH[:12]
            model = load_model(args.harmonization / f"model-{prefix}.json")
            baseline = load_policy(args.harmonization / f"baseline-{prefix}.json")
        polygon = polygon_from_area(args.area) if args.area else Polygon(json.loads(args.polygon.read_text(encoding="utf-8")).get("geometry", json.loads(args.polygon.read_text(encoding="utf-8"))))
        comparison = {"start": args.comparison_start, "end": args.comparison_end} if args.comparison_start and args.comparison_end else None
        built = build_result(args.store, polygon, args.start, args.end, comparison, name=args.area or args.polygon.stem, model=model, baseline=baseline)
    except (ValueError, OSError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    result = built["result"]
    folder = args.out / result["area"]["geometryHash"].split(":")[1][:12]
    write_json(folder / "result.json", result)
    write_json(folder / "manifest.json", built["manifest"])
    months = [m["month"] for m in result["months"]]
    write_json(folder / f"daily-{months[0]}.json", daily_page(built["counts"], result["id"], months[0], harmonized=built["harmonized"].get(months[0])))
    write_json(folder / "detections-page-1.json", detections_page(args.store, polygon, result["id"], args.start, args.end))
    if args.export:
        rows = write_raw_hotspots(args.store, polygon, args.start, args.end, folder / "raw-hotspots.csv")
        write_aggregates(result, folder / "harmonized-aggregates.csv")
        print(f"exported {rows} original detections and the aggregate table -> {folder}")
    primary = result["primary"]["metric"]
    print(f"{result['area']['name']} {args.start}..{args.end}: raw {primary['rawCount']} by source {primary['rawCountsBySource']}, harmonized {primary['harmonizedCount']} ({primary['status']}, {result['method']['validation']}) -> {folder}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
