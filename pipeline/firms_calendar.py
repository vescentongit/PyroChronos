"""Build a monthly burning-activity calendar for any area from the global FIRMS grid.

Usage:
  python pipeline/firms_calendar.py --source MODIS_SP --area kalteng
  python pipeline/firms_calendar.py --source MODIS_SP --area 94,-12,142,7 --include-low
Months without archive coverage are null; covered months without detections are 0
detections, which is not evidence that no fire occurred.
"""

import argparse
import calendar as cal
import csv
import gzip
import json
import sys
from pathlib import Path
from statistics import median

from firms_archive import GRID_VERSION, ROOT
from firms_catalog import FEATURED_REGIONS, get_source, inside, resolve_area

SCHEMA_VERSION = "calendar-1"
DEFAULT_TYPES = ("vegetation", "unknown")


def coverage(grid_dir, source_id):
    """Latest manifest entry per year for one source."""
    manifest = Path(grid_dir) / "manifest.jsonl"
    years = {}
    if manifest.exists():
        for line in manifest.read_text(encoding="utf-8").splitlines():
            entry = json.loads(line)
            if entry["source"] == source_id and entry.get("grid_version") == GRID_VERSION:
                years[entry["year"]] = entry
    return dict(sorted(years.items()))


def _month_status(month, entry):
    first, last = entry.get("first_observed"), entry.get("last_observed")
    if not first or month < first[:7] or month > last[:7]:
        return "no_data"
    year, number = map(int, month.split("-"))
    end_day = cal.monthrange(year, number)[1]
    if month == last[:7] and int(last[8:10]) < end_day:
        return "partial"
    if month == first[:7] and int(first[8:10]) > 1:
        return "partial"
    return "observed"


def build(grid_dir, source_id, area, include_low=False, fire_types=DEFAULT_TYPES):
    source = get_source(source_id)
    area_id, bbox = resolve_area(area)
    years = coverage(grid_dir, source_id)
    if not years:
        raise ValueError(f"No processed grid for {source_id}; run firms_archive.py first")
    confidences = {"low", "nominal", "high"} if include_low else {"nominal", "high"}
    cell = next(iter(years.values()))["cell_degrees"]
    sums = {}
    for year, entry in years.items():
        path = Path(grid_dir) / entry["grid_path"]
        with gzip.open(path, "rt", encoding="utf-8", newline="") as handle:
            for row in csv.DictReader(handle):
                if row["fire_type"] not in fire_types or row["confidence"] not in confidences:
                    continue
                lon = (int(row["cell_x"]) + 0.5) * cell - 180
                lat = (int(row["cell_y"]) + 0.5) * cell - 90
                if not inside(lon, lat, bbox):
                    continue
                total = sums.setdefault(row["month"], [0, 0.0])
                total[0] += int(row["detections"])
                total[1] += float(row["frp_sum_mw"])
    months = []
    for year, entry in years.items():
        for number in range(1, 13):
            month = f"{year}-{number:02d}"
            status = _month_status(month, entry)
            detections, frp = sums.get(month, [0, 0.0])
            months.append({
                "month": month,
                "status": status,
                "detections": None if status == "no_data" else detections,
                "frp_sum_mw": None if status == "no_data" else round(frp, 1),
            })
    climatology = {}
    for number in range(1, 13):
        values = [m["detections"] for m in months if m["status"] == "observed" and int(m["month"][5:]) == number]
        climatology[f"{number:02d}"] = {"median": median(values) if values else None, "years": len(values)}
    return {
        "schemaVersion": SCHEMA_VERSION,
        "source": source_id,
        "sensor": source.sensor,
        "harmonized": False,
        "area": {"id": area_id, "bbox": list(bbox), "featured": area_id in FEATURED_REGIONS},
        "grid": {"version": GRID_VERSION, "cellDegrees": cell, "cellRule": "cell centre inside bbox"},
        "filters": {"fireTypes": list(fire_types), "confidence": sorted(confidences)},
        "unit": "detections",
        "archive": [{"year": y, "sha256": e["sha256"], "firstObserved": e["first_observed"], "lastObserved": e["last_observed"]} for y, e in years.items()],
        "months": months,
        "climatology": climatology,
    }


def anomaly(result, month):
    """Compare one month with the median of the same calendar month in other observed years."""
    target = next((m for m in result["months"] if m["month"] == month), None)
    if target is None or target["status"] == "no_data":
        return {"month": month, "status": "no_data", "value": None, "median": None, "difference": None, "ratio": None, "percentile": None, "years": 0}
    history = [m["detections"] for m in result["months"] if m["status"] == "observed" and m["month"][5:] == month[5:] and m["month"] != month]
    if not history:
        return {"month": month, "status": "insufficient_history", "value": target["detections"], "median": None, "difference": None, "ratio": None, "percentile": None, "years": 0}
    middle = median(history)
    below = sum(value < target["detections"] for value in history) + 0.5 * sum(value == target["detections"] for value in history)
    return {
        "month": month,
        "status": "partial" if target["status"] == "partial" else "assessed",
        "value": target["detections"],
        "median": middle,
        "difference": target["detections"] - middle,
        "ratio": None if middle == 0 else round(target["detections"] / middle, 3),
        "percentile": round(100 * below / len(history), 1),
        "years": len(history),
    }


def render(result):
    rows = {}
    for m in result["months"]:
        value = m["detections"]
        text = "—" if value is None else f"{value}{'*' if m['status'] == 'partial' else ''}"
        rows.setdefault(m["month"][:4], []).append(text)
    width = max(6, *(len(t) for r in rows.values() for t in r))
    lines = ["year " + "".join(f"{cal.month_abbr[n]:>{width + 1}}" for n in range(1, 13))]
    lines += [f"{year} " + "".join(f"{t:>{width + 1}}" for t in texts) for year, texts in rows.items()]
    lines.append("med  " + "".join(f"{('—' if c['median'] is None else c['median']):>{width + 1}}" for c in result["climatology"].values()))
    return "\n".join(lines)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--source", required=True)
    parser.add_argument("--area", required=True, help="kalteng, papua, world, or west,south,east,north")
    parser.add_argument("--include-low", action="store_true")
    parser.add_argument("--grid", default=ROOT / "data" / "processed" / "grid", type=Path)
    parser.add_argument("--out", default=ROOT / "data" / "processed" / "calendar", type=Path)
    args = parser.parse_args(argv)
    try:
        result = build(args.grid, args.source, args.area, args.include_low)
    except ValueError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    args.out.mkdir(parents=True, exist_ok=True)
    path = args.out / f"{args.source}_{result['area']['id']}.json"
    path.write_text(json.dumps(result, indent=1) + "\n", encoding="utf-8")
    print(render(result))
    print(f"\n{result['unit']} per month, {args.source}, not harmonized; * partial month, — no archive coverage -> {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
