"""Frozen configuration for MODIS-equivalent harmonization of VIIRS S-NPP detections.

Everything here is fixed before any evaluation result is looked at. Changing a value
changes configHash, which invalidates pair tables, evaluations and published results.
"""

import hashlib
import json

CONFIG_VERSION = "harmonization-config-1"
REFERENCE_SOURCE = "MODIS_SP"
HARMONIZED_SOURCE = "VIIRS_SNPP_SP"
REFERENCE_SATELLITES = ("Terra", "Aqua")
HARMONIZED_SATELLITES = ("Suomi NPP",)
NOMINAL_OVERPASSES_PER_DAY = {"MODIS_SP": 4, "VIIRS_SNPP_SP": 2}
EXCLUDED_SATELLITES = {"NOAA-20": "not processed into the store yet", "NOAA-21": "not processed into the store yet"}

CELL_DEGREES = 1.0
TIME_UNIT = "calendar-month-utc"
PAIR_RULE = "a pair is one 1-degree cell and one UTC calendar month where the reference archive and the VIIRS archive both cover the whole month; cells with at least one accepted detection in either source are listed, cells with none in both are not enumerated"
FIRST_PAIRED_MONTH = "2013-01"

SPLIT = {
    "train": {"start": "2013-01", "end": "2018-12"},
    "validation": {"start": "2019-01", "end": "2020-12"},
    "test": {"start": "2021-01", "end": "2025-12"},
}
SPLIT_RULE = "split by whole calendar years so no cell-month of a later split shares a year with an earlier one; models are fitted on train only, candidates and thresholds are chosen on validation only, test is scored once"

DOMAINS = (
    ("south_america", (-82.0, -56.0, -34.0, 13.0)),
    ("africa_north_of_equator", (-20.0, 0.0, 52.0, 37.0)),
    ("africa_south_of_equator", (-20.0, -36.0, 52.0, 0.0)),
    ("maritime_southeast_asia", (92.0, -12.0, 155.0, 11.0)),
    ("australia", (112.0, -45.0, 155.0, -12.0)),
    ("south_and_mainland_southeast_asia", (60.0, 11.0, 110.0, 40.0)),
    ("north_america", (-170.0, 13.0, -50.0, 72.0)),
    ("boreal_eurasia", (20.0, 50.0, 180.0, 80.0)),
    ("europe_mediterranean", (-12.0, 36.0, 45.0, 60.0)),
)
DOMAIN_RULE = "first matching box wins, evaluated on the 1-degree cell centre; unmatched cells are domain 'other' and are never validated"
OTHER_DOMAIN = "other"

CANDIDATES = ("raw_alignment", "ratio_global", "ratio_domain", "affine_global", "eqm_global")
ADDITIVE_CANDIDATES = ("raw_alignment", "ratio_global", "ratio_domain")
CANDIDATE_NOTES = {
    "raw_alignment": "VIIRS count taken as the MODIS-scale count without correction",
    "ratio_global": "one least-squares multiplier through the origin, fitted on train",
    "ratio_domain": "one least-squares multiplier per domain through the origin, fitted on train",
    "affine_global": "least-squares intercept and slope on train; not additive and not zero-preserving",
    "eqm_global": "empirical quantile mapping of positive counts, fitted on train; not additive",
}
SELECTION_RULE = "the published method is the additive candidate with the lowest validation MAE on cell-months; non-additive candidates are evaluated and reported but cannot be applied to arbitrary clipped polygons or to daily allocation"

DECISION_RULE = {
    "version": "decision-rule-1",
    "minimumTestCellMonths": 500,
    "minimumMaeReductionVersusRaw": 0.20,
    "maximumAbsoluteRelativeBiasAggregated": 0.15,
    "aggregateUnit": "domain-month sum over cells",
    "transferRequired": True,
    "transferRule": "the same model family refitted without the domain on train must also meet both thresholds on the domain's test cell-months",
    "outsideSupportMaximumShare": 0.10,
    "text": "a domain is validated when, on test, its cell-months number at least minimumTestCellMonths, MAE falls by at least minimumMaeReductionVersusRaw against raw alignment, absolute relative bias of domain-month sums is at most maximumAbsoluteRelativeBiasAggregated, the leave-domain-out transfer meets both thresholds, and no more than outsideSupportMaximumShare of test VIIRS counts exceed the train support",
}

SUPPORT_RULE = "a polygon is supported only when every sampled interior point (vertices plus a grid of at most 4000 points) falls in a validated domain; a polygon touching an unvalidated domain, 'other' or the sampling gap gets no estimate"
SUPPORT_MAX_SAMPLES = 4000

COUNT_BINS =((0, 0), (1, 2), (3, 9), (10, 49), (50, None))
SEASONS = {"DJF": (12, 1, 2), "MAM": (3, 4, 5), "JJA": (6, 7, 8), "SON": (9, 10, 11)}

BASELINE = {
    "version": "reference-policy-1",
    "kind": "rolling-same-calendar-period",
    "windowYears": 10,
    "statistic": "median",
    "scoreKind": "percentile",
    "series": "harmonized VIIRS estimate on the MODIS scale; years without a validated estimate are missing and are never filled with zero or with native MODIS counts",
    "window": "same month-day range in each reference year Y-windowYears..Y-1; the target year and later years are never used",
    "leapRule": "when the reference window has a different number of days than the target window because of 29 February, the reference value is scaled by target days / reference days",
    "partialRule": "a partial target month is compared only with the same month-day range of reference years; a reference year whose archive does not cover that whole range is missing",
    "zeroRule": "an all-zero reference or identical reference values give a baseline and delta but no score",
    "tieRule": "percentile counts ties as half",
}
MINIMUM_YEARS_SELECTION = {
    "rule": "smallest k in 3..windowYears whose backtest MAE of the median forecast is within tolerance of the k=windowYears MAE",
    "tolerance": 0.10,
    "backtestSeries": "native MODIS cell-month counts per domain, 2000-2025",
    "targetYears": "validation split only",
}


def digest():
    payload = {
        "version": CONFIG_VERSION,
        "reference": REFERENCE_SOURCE,
        "harmonized": HARMONIZED_SOURCE,
        "cell": CELL_DEGREES,
        "time": TIME_UNIT,
        "split": SPLIT,
        "domains": DOMAINS,
        "candidates": CANDIDATES,
        "selection": SELECTION_RULE,
        "decision": DECISION_RULE,
        "baseline": BASELINE,
        "minimumYears": MINIMUM_YEARS_SELECTION,
        "support": SUPPORT_RULE,
    }
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


CONFIG_HASH = digest()


def domain_of(lon, lat):
    for name, (west, south, east, north) in DOMAINS:
        if west <= lon < east and south <= lat < north:
            return name
    return OTHER_DOMAIN


def split_of(month):
    for name, span in SPLIT.items():
        if span["start"] <= month <= span["end"]:
            return name
    return None


def describe():
    return {
        "version": CONFIG_VERSION,
        "hash": CONFIG_HASH,
        "referenceSource": REFERENCE_SOURCE,
        "harmonizedSource": HARMONIZED_SOURCE,
        "satellites": {"reference": list(REFERENCE_SATELLITES), "harmonized": list(HARMONIZED_SATELLITES), "excluded": EXCLUDED_SATELLITES, "nominalOverpassesPerDay": NOMINAL_OVERPASSES_PER_DAY},
        "cellDegrees": CELL_DEGREES,
        "timeUnit": TIME_UNIT,
        "pairRule": PAIR_RULE,
        "split": SPLIT,
        "splitRule": SPLIT_RULE,
        "domains": {name: list(box) for name, box in DOMAINS},
        "domainRule": DOMAIN_RULE,
        "candidates": CANDIDATE_NOTES,
        "selectionRule": SELECTION_RULE,
        "decisionRule": DECISION_RULE,
        "baseline": BASELINE,
        "minimumYearsSelection": MINIMUM_YEARS_SELECTION,
        "supportRule": SUPPORT_RULE,
    }
