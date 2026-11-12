"""Harmonized counts for a polygon and the rolling same-calendar-period reference (R2-P1-N2/N3).

Usage:
  python pipeline/reference_baseline.py --minimum-years
The multiplier of the selected additive method is applied to accepted VIIRS S-NPP detections
inside the polygon, so month, day and period totals agree by construction. The reference for a
target window uses the same month-day range in years Y-window..Y-1 only; years without a
fully covered window or without a supported polygon are missing, never zero.
"""

import argparse
import json
import sys
from calendar import monthrange
from datetime import date
from math import isfinite
from pathlib import Path
from statistics import median

import harmonize_config as config
from area_counts import QUALITY_POLICY, accepts, source_coverage
from area_query import Polygon, query
from detection_store import minute_to_iso
from harmonize_pairs import ROOT, cell_center, load_counts, month_range

keep = accepts(QUALITY_POLICY)


def load_model(path):
    model = json.loads(Path(path).read_text(encoding="utf-8"))
    if model.get("configHash") != config.CONFIG_HASH:
        raise ValueError("model was fitted under a different harmonization configuration")
    return model


def multiplier(model, lon, lat):
    if model["family"] == "ratio_global":
        domain = config.domain_of(lon, lat)
        return model["ratio"] if domain in model["validatedDomains"] else None
    if model["family"] == "ratio_domain":
        domain = config.domain_of(lon, lat)
        return model["ratios"].get(domain) if domain in model["validatedDomains"] else None
    raise ValueError(f"unsupported model family {model['family']}")


def polygon_domains(polygon):
    """Domains of the polygon vertices and of a bounded grid of interior sample points."""
    points = {(lon, lat) for ring in [polygon.geometry["coordinates"][0]] for lon, lat in ring}
    for west, south, east, north in polygon.bbox_pieces():
        width, height = east - west, north - south
        step = max(0.05, (width * height / config.SUPPORT_MAX_SAMPLES) ** 0.5) if width * height else 0.05
        lat = south + step / 2
        while lat < north:
            lon = west + step / 2
            while lon < east:
                shifted = lon - 360 if lon > 180 else lon
                if polygon.contains(shifted, lat):
                    points.add((shifted, lat))
                lon += step
            lat += step
    return {config.domain_of(lon, lat) for lon, lat in points}


def support(polygon, model):
    """(supported, domains): estimates exist only when every sampled point is in a validated domain."""
    domains = polygon_domains(polygon)
    return domains <= set(model["validatedDomains"]), sorted(domains)


def window_covered(coverage, start, end):
    entry = coverage.get(start.year)
    if entry is None or end.year != start.year or not entry.get("first_observed"):
        return False
    return date.fromisoformat(entry["first_observed"][:10]) <= start and end <= date.fromisoformat(entry["last_observed"][:10])


def harmonized_window(store_dir, polygon, model, start, end):
    """Harmonized VIIRS estimate over inclusive dates: (value or None, raw VIIRS count or None, per-day values)."""
    coverage = source_coverage(store_dir, config.HARMONIZED_SOURCE)
    if not window_covered(coverage, start, end):
        return None, None, {}
    days, raw = {}, 0
    for item in query(store_dir, config.HARMONIZED_SOURCE, polygon, start.isoformat(), end.isoformat()):
        if not keep(item):
            continue
        factor = multiplier(model, item["lon"], item["lat"])
        if factor is None:
            raise ValueError("detection in an unvalidated domain; check support() first")
        day = minute_to_iso(item["minute"])[:10]
        days[day] = days.get(day, 0.0) + factor
        raw += 1
    return sum(days.values()), raw, days


def reference_window(start, end, year):
    def clip(moment):
        return date(year, moment.month, min(moment.day, monthrange(year, moment.month)[1]))

    return clip(start), clip(end)


def percentile(value, reference):
    below = sum(v < value for v in reference) + 0.5 * sum(v == value for v in reference)
    return 100.0 * below / len(reference)


def reference_values(store_dir, polygon, model, start, end, window_years, first_year=None):
    """Harmonized values of the same month-day range in Y-window..Y-1; unsupported/uncovered years are absent."""
    target_days = (end - start).days + 1
    values = {}
    for year in range(start.year - window_years, start.year):
        if first_year is not None and year < first_year:
            continue
        ref_start, ref_end = reference_window(start, end, year)
        value, _, _ = harmonized_window(store_dir, polygon, model, ref_start, ref_end)
        if value is None:
            continue
        ref_days = (ref_end - ref_start).days + 1
        values[year] = value * target_days / ref_days
    return values


def anomaly(target_value, values, window_years, minimum_years, supported_polygon, target_known):
    """research-2 anomaly object from the target estimate and the reference values by year."""
    empty = {"referenceYears": [], "baselineStatistic": None, "baselineValue": None, "delta": None, "scoreKind": None, "score": None}
    if not supported_polygon:
        return {"status": "method_unsupported", **empty}
    if not target_known:
        return {"status": "insufficient_data", **empty}
    years = sorted(values)
    if len(years) < minimum_years:
        return {"status": "insufficient_history", **empty, "referenceYears": years}
    reference = [round(values[y], 6) for y in years]
    baseline = round(median(reference), 6)
    target = round(target_value, 6)
    varied = len(set(reference)) > 1
    score = round(percentile(target, reference), 3) if varied else None
    return {
        "status": "assessed",
        "referenceYears": years,
        "baselineStatistic": "median",
        "baselineValue": baseline,
        "delta": round(target - baseline, 6),
        "scoreKind": "percentile" if varied else None,
        "score": score,
    }


def domain_month_series(out_dir, years):
    """Native MODIS counts summed per validated-or-not domain and calendar month, 2000-2025."""
    counts = load_counts(out_dir, config.REFERENCE_SOURCE, years)
    series = {}
    for month, entry in counts.items():
        for key, count in entry["cells"].items():
            domain = config.domain_of(*cell_center(key))
            series[(domain, month)] = series.get((domain, month), 0) + count
    return series


def select_minimum_years(out_dir):
    """Backtest the median forecast with k most recent prior years; pick the smallest adequate k."""
    window = config.BASELINE["windowYears"]
    tolerance = config.MINIMUM_YEARS_SELECTION["tolerance"]
    series = domain_month_series(out_dir, range(2000, 2026))
    domains = sorted({d for d, _ in series if d != config.OTHER_DOMAIN})
    targets = [m for m in month_range(config.SPLIT["validation"]["start"], config.SPLIT["validation"]["end"])]
    errors = {k: [0.0, 0.0] for k in range(3, window + 1)}
    for domain in domains:
        for month in targets:
            year, number = int(month[:4]), month[5:]
            actual = series.get((domain, month))
            if actual is None:
                continue
            history = [(y, series.get((domain, f"{y}-{number}"))) for y in range(year - window, year)]
            history = [(y, v) for y, v in history if v is not None]
            for k in errors:
                recent = [v for _, v in history[-k:]]
                if len(recent) < k:
                    continue
                errors[k][0] += abs(median(recent) - actual)
                errors[k][1] += actual
    relative = {k: e[0] / e[1] for k, e in errors.items() if e[1] > 0}
    best = relative[window]
    chosen = next(k for k in sorted(relative) if relative[k] <= best * (1 + tolerance))
    return {
        "schema": "minimum-years-1",
        "configHash": config.CONFIG_HASH,
        "rule": config.MINIMUM_YEARS_SELECTION,
        "relativeMaeByYears": {str(k): round(v, 5) for k, v in sorted(relative.items())},
        "windowYears": window,
        "minimumValidYears": chosen,
        "series": "native MODIS domain-month counts; the same rule is applied to the harmonized series because the harmonized series is a fixed multiple of VIIRS and a shorter VIIRS record only reduces the usable years",
    }


def baseline_policy(selection):
    return {
        "policyVersion": config.BASELINE["version"],
        "kind": config.BASELINE["kind"],
        "windowYears": config.BASELINE["windowYears"],
        "minimumValidYears": selection["minimumValidYears"],
        "statistic": config.BASELINE["statistic"],
        "scoreKind": config.BASELINE["scoreKind"],
        "selection": selection,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--minimum-years", action="store_true")
    parser.add_argument("--dir", default=ROOT / "data" / "processed" / "harmonization", type=Path)
    args = parser.parse_args(argv)
    if args.minimum_years:
        selection = select_minimum_years(args.dir)
        path = args.dir / f"baseline-{config.CONFIG_HASH[:12]}.json"
        path.write_text(json.dumps(baseline_policy(selection), indent=1) + "\n", encoding="utf-8")
        print(f"relative MAE by k: {selection['relativeMaeByYears']}")
        print(f"minimumValidYears = {selection['minimumValidYears']} -> {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
