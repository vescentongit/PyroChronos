"""Freeze an NRT snapshot and compare it with the standard archive once that archive covers the same days (R2-P2-N1).

Usage:
  python pipeline/nrt_snapshot.py --freeze
  python pipeline/nrt_snapshot.py --compare
Freeze verifies every raw batch against its manifest checksum and writes per-area daily counts with
batch identity. Compare uses the pcd1 store for the standard source and reports a day as comparable
only when that archive covers the whole UTC month; otherwise the day stays not_comparable and no
difference is stated. Results describe revision of the listed batches, not NRT performance in the past.
"""

import argparse
import hashlib
import json
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from statistics import median

from area_counts import QUALITY_POLICY, accepts, month_status
from area_query import Polygon, query
from firms_parse import parse_batch
from harmonize_pairs import ROOT
from reference_baseline import percentile, reference_window
from research_adapter import source_coverage

SNAPSHOT_VERSION = "nrt-snapshot-1"
SCALES = (0.5, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.5)
WINDOW_YEARS = 10
MINIMUM_YEARS = 4
PAIRS = {"VIIRS_SNPP_NRT": "VIIRS_SNPP_SP", "MODIS_NRT": "MODIS_SP"}
AREAS_NOTE = "boxes are the bounding boxes passed to the FIRMS area API; counts use the same quality policy as the research counts"


def verify_and_parse(raw_dir, entry):
    path = Path(raw_dir) / entry["path"]
    body = path.read_bytes()
    if hashlib.sha256(body).hexdigest() != entry["sha256"]:
        raise ValueError(f"checksum mismatch: {entry['path']}")
    start = datetime.fromisoformat(entry["start_date"]).replace(tzinfo=timezone.utc)
    return parse_batch(body.decode("utf-8"), entry["source"], (start, start + timedelta(days=entry["day_range"])))


def keep(record):
    return (record["fire_type"] or "unknown") in QUALITY_POLICY["fireTypes"] and record["confidence_class"] in QUALITY_POLICY["confidenceClasses"]


def freeze(raw_dir, source):
    areas = {}
    for manifest in sorted((Path(raw_dir) / source).glob("*/manifest.jsonl")):
        entries = {}
        for line in manifest.read_text(encoding="utf-8").splitlines():
            entry = json.loads(line)
            entries[entry["sha256"]] = entry
        days, seen, batches = defaultdict(int), set(), []
        bbox = None
        for entry in sorted(entries.values(), key=lambda e: e["start_date"]):
            parsed = verify_and_parse(raw_dir, entry)
            bbox = entry["bbox"]
            for record in parsed["records"]:
                if record["id"] in seen or not keep(record):
                    continue
                seen.add(record["id"])
                days[record["observed_at"][:10]] += 1
            batches.append({"path": entry["path"], "sha256": entry["sha256"], "fetchedAt": entry["fetched_at"], "startDate": entry["start_date"], "dayRange": entry["day_range"], "rows": entry["counts"]["rows"]})
        first = min(b["startDate"] for b in batches)
        last = max((date.fromisoformat(b["startDate"]) + timedelta(days=b["dayRange"] - 1)).isoformat() for b in batches)
        areas[manifest.parent.name] = {"bbox": bbox, "firstDay": first, "lastDay": last, "batches": batches, "dailyCounts": dict(sorted(days.items())), "total": sum(days.values())}
    content = {"schema": SNAPSHOT_VERSION, "source": source, "standardSource": PAIRS[source], "qualityPolicyVersion": QUALITY_POLICY["version"], "note": AREAS_NOTE, "areas": areas}
    digest = hashlib.sha256(json.dumps(content, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return {"id": f"nrt-snapshot-{digest[:16]}", **content}


def polygon_of(bbox):
    west, south, east, north = bbox
    return Polygon({"type": "Polygon", "coordinates": [[[west, south], [east, south], [east, north], [west, north], [west, south]]]})


def compare(snapshot, store_dir):
    coverage = source_coverage(store_dir, snapshot["standardSource"])
    keep_item = accepts(QUALITY_POLICY)
    report = {}
    for name, area in snapshot["areas"].items():
        days = sorted(area["dailyCounts"])
        first, last = date.fromisoformat(area["firstDay"]), date.fromisoformat(area["lastDay"])
        every_day = [(first + timedelta(days=i)).isoformat() for i in range((last - first).days + 1)]
        comparable = [d for d in every_day if month_status(coverage, d[:7]) == "observed"]
        entry = {"daysInSnapshot": len(every_day), "comparableDays": len(comparable), "verdict": "not_comparable"}
        if comparable:
            standard = defaultdict(int)
            for item in query(store_dir, snapshot["standardSource"], polygon_of(area["bbox"]), comparable[0], comparable[-1]):
                if keep_item(item) and item["observedAt"][:10] in comparable:
                    standard[item["observedAt"][:10]] += 1
            nrt = sum(area["dailyCounts"].get(d, 0) for d in comparable)
            archive = sum(standard.values())
            entry.update({"verdict": "compared", "nrtCount": nrt, "standardCount": archive, "relativeChange": (archive - nrt) / nrt if nrt else None, "daily": {d: {"nrt": area["dailyCounts"].get(d, 0), "standard": standard.get(d, 0)} for d in comparable}})
        report[name] = entry
    return {"snapshotId": snapshot["id"], "standardSource": snapshot["standardSource"], "areas": report, "interpretation": "only days whose whole UTC month is covered by the standard archive are compared; a difference describes revision of these batches and is not a measure of NRT performance for other periods"}


def window_count(store_dir, source, polygon, start, end, keep_item):
    return sum(1 for item in query(store_dir, source, polygon, start.isoformat(), end.isoformat()) if keep_item(item))


def sensitivity(snapshot, store_dir):
    coverage = source_coverage(store_dir, snapshot["standardSource"])
    keep_item = accepts(QUALITY_POLICY)
    report = {}
    for name, area in snapshot["areas"].items():
        first, last = date.fromisoformat(area["firstDay"]), date.fromisoformat(area["lastDay"])
        days = (last - first).days + 1
        if days < 20:
            report[name] = {"verdict": "skipped", "reason": f"snapshot window of {days} days is too short for a period assessment"}
            continue
        polygon = polygon_of(area["bbox"])
        target = sum(area["dailyCounts"].values())
        values = {}
        for year in range(first.year - WINDOW_YEARS, first.year):
            ref_start, ref_end = reference_window(first, last, year)
            months = {(ref_start + timedelta(days=i)).strftime("%Y-%m") for i in range((ref_end - ref_start).days + 1)}
            if all(month_status(coverage, month) == "observed" for month in months):
                values[year] = window_count(store_dir, snapshot["standardSource"], polygon, ref_start, ref_end, keep_item)
        if len(values) < MINIMUM_YEARS:
            report[name] = {"verdict": "insufficient_history", "referenceYears": sorted(values)}
            continue
        reference = [values[y] for y in sorted(values)]
        base = median(reference)
        rows = []
        for scale in SCALES:
            scaled = target * scale
            rows.append({"nrtScale": scale, "count": round(scaled, 1), "percentile": round(percentile(scaled, reference), 1), "aboveMedian": scaled > base})
        crossing = base / target if target else None
        report[name] = {
            "verdict": "assessed",
            "window": [first.isoformat(), last.isoformat()],
            "nrtCount": target,
            "referenceYears": sorted(values),
            "referenceCounts": values,
            "baselineMedian": base,
            "scaleThatReachesMedian": crossing,
            "scaleThatLeavesReferenceRange": {"below": min(reference) / target if target else None, "above": max(reference) / target if target else None},
            "sweep": rows,
        }
    return {
        "snapshotId": snapshot["id"],
        "kind": "assumed NRT-to-standard scale sweep; the scale values are hypothetical and are not measured revisions",
        "referencePolicy": f"same month-day window in the {WINDOW_YEARS} previous years, standard archive only, minimum {MINIMUM_YEARS} years, raw VIIRS S-NPP counts under {QUALITY_POLICY['version']}",
        "areas": report,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--freeze", action="store_true")
    parser.add_argument("--compare", action="store_true")
    parser.add_argument("--sensitivity", action="store_true")
    parser.add_argument("--source", default="VIIRS_SNPP_NRT")
    parser.add_argument("--raw", default=ROOT / "data" / "raw" / "firms", type=Path)
    parser.add_argument("--store", default=ROOT / "data" / "processed" / "detections", type=Path)
    parser.add_argument("--out", default=ROOT / "docs" / "data" / "nrt", type=Path)
    args = parser.parse_args(argv)
    args.out.mkdir(parents=True, exist_ok=True)
    try:
        if args.freeze:
            snapshot = freeze(args.raw, args.source)
            (args.out / f"{args.source}-snapshot.json").write_text(json.dumps(snapshot, indent=1) + "\n", encoding="utf-8")
            print(snapshot["id"], {k: (v["firstDay"], v["lastDay"], v["total"]) for k, v in snapshot["areas"].items()})
        if args.compare:
            snapshot = json.loads((args.out / f"{args.source}-snapshot.json").read_text(encoding="utf-8"))
            report = compare(snapshot, args.store)
            (args.out / f"{args.source}-comparison.json").write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8")
            print(json.dumps({k: {x: y for x, y in v.items() if x != "daily"} for k, v in report["areas"].items()}, indent=1))
        if args.sensitivity:
            snapshot = json.loads((args.out / f"{args.source}-snapshot.json").read_text(encoding="utf-8"))
            report = sensitivity(snapshot, args.store)
            (args.out / f"{args.source}-sensitivity.json").write_text(json.dumps(report, indent=1) + chr(10), encoding="utf-8")
            print(json.dumps({k: {x: y for x, y in v.items() if x not in ("sweep", "referenceCounts")} for k, v in report["areas"].items()}, indent=1))
    except (ValueError, OSError, KeyError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
