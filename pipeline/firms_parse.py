"""Parse and validate FIRMS CSV rows without turning bad or missing data into zeros."""

import csv
import hashlib
import io
from datetime import datetime, timezone
from math import isfinite

from firms_catalog import REQUIRED_COLUMNS, get_source

SATELLITES = {
    "T": "Terra", "TERRA": "Terra",
    "A": "Aqua", "AQUA": "Aqua",
    "N": "Suomi NPP", "NPP": "Suomi NPP", "SNPP": "Suomi NPP",
    "1": "NOAA-20", "N20": "NOAA-20", "NOAA-20": "NOAA-20",
    "2": "NOAA-21", "N21": "NOAA-21", "NOAA-21": "NOAA-21",
}
VIIRS_CLASSES = {"l": "low", "low": "low", "n": "nominal", "nominal": "nominal", "h": "high", "high": "high"}
FIRE_TYPES = {"0": "vegetation", "1": "volcano", "2": "static", "3": "offshore"}
KNOWN_COLUMNS = {"scan", "track", "instrument", "bright_t31", "bright_ti5", "type"}


class FirmsSchemaError(ValueError):
    pass


def _modis_class(value):
    percent = float(value)
    if not isfinite(percent) or not 0 <= percent <= 100:
        raise ValueError
    return "low" if percent < 30 else "nominal" if percent < 80 else "high"


def _timestamp(date, time):
    if len(time) > 4 or not time.isdigit():
        raise ValueError
    return datetime.strptime(f"{date} {time.zfill(4)}", "%Y-%m-%d %H%M").replace(tzinfo=timezone.utc)


def _iso(moment):
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


class RowParser:
    """Validates rows of one FIRMS CSV schema; use for streaming large archives."""

    def __init__(self, header, source_id, window=None):
        self.source = get_source(source_id)
        self.source_id = source_id
        self.window = window
        self.header = [field.strip().lstrip("﻿") for field in header]
        missing = [c for c in REQUIRED_COLUMNS[self.source.sensor] if c not in self.header]
        if missing:
            raise FirmsSchemaError(f"FIRMS schema mismatch for {source_id}; missing {', '.join(missing)}")
        self.index = {column: position for position, column in enumerate(self.header)}
        known = set(REQUIRED_COLUMNS[self.source.sensor]) | KNOWN_COLUMNS
        self.warnings = [f"unexpected column: {c}" for c in self.header if c not in known]

    def _warn(self, message):
        if message not in self.warnings:
            self.warnings.append(message)

    def parse(self, row, line):
        """Return (record, None) or (None, reject)."""
        if len(row) != len(self.header):
            return None, {"line": line, "reason": "column_count", "raw": row}
        get = lambda column: row[self.index[column]].strip()
        try:
            lat, lon = float(get("latitude")), float(get("longitude"))
            if not (isfinite(lat) and isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180):
                raise ValueError
        except ValueError:
            return None, {"line": line, "reason": "coordinate", "raw": row}
        try:
            observed = _timestamp(get("acq_date"), get("acq_time"))
        except ValueError:
            return None, {"line": line, "reason": "timestamp", "raw": row}
        raw_confidence = get("confidence")
        try:
            confidence = _modis_class(raw_confidence) if self.source.confidence_scheme == "percent" else VIIRS_CLASSES[raw_confidence.lower()]
        except (ValueError, KeyError):
            return None, {"line": line, "reason": "confidence", "raw": row}
        raw_frp = get("frp")
        try:
            frp = float(raw_frp) if raw_frp else None
            if frp is not None and (not isfinite(frp) or frp < 0):
                raise ValueError
        except ValueError:
            return None, {"line": line, "reason": "frp", "raw": row}
        raw_satellite = get("satellite")
        satellite = SATELLITES.get(raw_satellite.upper())
        if satellite is None:
            satellite = raw_satellite
            self._warn(f"unknown satellite code: {raw_satellite}")
        fire_type = None
        if "type" in self.index:
            fire_type = FIRE_TYPES.get(get("type"))
            if fire_type is None:
                return None, {"line": line, "reason": "fire_type", "raw": row}
        observed_at = _iso(observed)
        key = "|".join(map(str, (self.source_id, lat, lon, observed_at, satellite)))
        return {
            "id": hashlib.sha256(key.encode()).hexdigest()[:24],
            "source": self.source_id,
            "sensor": self.source.sensor,
            "processing": self.source.processing,
            "satellite": satellite,
            "lat": lat,
            "lon": lon,
            "observed_at": observed_at,
            "confidence_raw": raw_confidence,
            "confidence_class": confidence,
            "frp_mw": frp,
            "daynight": get("daynight") or None,
            "product_version": get("version") or None,
            "fire_type": fire_type,
            "outside_window": self.window is not None and not self.window[0] <= observed < self.window[1],
        }, None


def parse_batch(text, source_id, window=None):
    """Return records, rejected rows, warnings and counts for one raw FIRMS CSV body.

    window: optional (start, end) aware datetimes of the requested acquisition period.
    """
    get_source(source_id)
    body = text.lstrip("﻿")
    if not body.strip():
        return _result(source_id, [], [], [], rows=0, duplicates=0)
    reader = csv.reader(io.StringIO(body))
    parser = RowParser(next(reader), source_id, window)
    records, rejects, seen = [], [], set()
    rows = duplicates = 0
    for line, row in enumerate(reader, start=2):
        if not any(cell.strip() for cell in row):
            continue
        rows += 1
        record, reject = parser.parse(row, line)
        if reject:
            rejects.append(reject)
        elif record["id"] in seen:
            duplicates += 1
        else:
            seen.add(record["id"])
            records.append(record)
    return _result(source_id, records, rejects, parser.warnings, rows=rows, duplicates=duplicates)


def _result(source_id, records, rejects, warnings, rows, duplicates):
    return {
        "source": source_id,
        "status": "empty" if rows == 0 else "parsed",
        "records": records,
        "rejects": rejects,
        "warnings": warnings,
        "counts": {
            "rows": rows,
            "accepted": len(records),
            "rejected": len(rejects),
            "duplicates": duplicates,
            "outside_window": sum(r["outside_window"] for r in records),
        },
    }
