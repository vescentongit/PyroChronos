"""Compact tiled store of original FIRMS detections, partitioned by source and month.

One file per source and month. Records keep original position (1e-5 degree), minute
of acquisition (UTC), FRP, satellite, fire type, day/night and the raw confidence code.
Records are grouped in 5-degree tiles, each zlib-compressed, so a bounding-box query
reads only the tiles it needs. This is the base for polygon and daily queries; the
0.25-degree grid is only a coarse aggregate.
"""

import hashlib
import json
import struct
import zlib
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from math import isfinite, nan
from pathlib import Path

from firms_catalog import REQUIRED_COLUMNS, get_source

FORMAT_VERSION = "pcd1"
MAGIC = b"PCD1"
RECORD = struct.Struct("<iiIfHB")
EPOCH = date(2000, 1, 1)
TILE_DEGREES = 5
TILES_X = 360 // TILE_DEGREES
TILES_Y = 180 // TILE_DEGREES
SCALE = 100000
SATELLITES = ("Terra", "Aqua", "Suomi NPP", "NOAA-20", "NOAA-21", "unknown")
FIRE_TYPES = ("vegetation", "volcano", "static", "offshore", "unknown")
DAYNIGHT = ("D", "N", "unknown")
VIIRS_CONFIDENCE_CODES = {"l": 101, "low": 101, "n": 102, "nominal": 102, "h": 103, "high": 103}
VIIRS_CONFIDENCE_LABELS = {101: "l", 102: "n", 103: "h"}
SATELLITE_CODES = {
    "T": 0, "TERRA": 0, "A": 1, "AQUA": 1,
    "N": 2, "NPP": 2, "SNPP": 2,
    "1": 3, "N20": 3, "NOAA-20": 3,
    "2": 4, "N21": 4, "NOAA-21": 4,
}
TYPE_CODES = {"0": 0, "1": 1, "2": 2, "3": 3}


def tile_of(lon, lat):
    x = min(TILES_X - 1, max(0, int((lon + 180) // TILE_DEGREES)))
    y = min(TILES_Y - 1, max(0, int((lat + 90) // TILE_DEGREES)))
    return y * TILES_X + x


def tiles_for_bbox(west, south, east, north):
    """Tile ids intersecting a non-antimeridian bbox."""
    x0 = min(TILES_X - 1, max(0, int((west + 180) // TILE_DEGREES)))
    x1 = min(TILES_X - 1, max(0, int((east + 180) // TILE_DEGREES)))
    y0 = min(TILES_Y - 1, max(0, int((south + 90) // TILE_DEGREES)))
    y1 = min(TILES_Y - 1, max(0, int((north + 90) // TILE_DEGREES)))
    return [y * TILES_X + x for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)]


def minute_of(moment):
    delta = moment - datetime(2000, 1, 1, tzinfo=timezone.utc)
    return delta.days * 1440 + delta.seconds // 60


def day_start_minute(day):
    return (day - EPOCH).days * 1440


def minute_to_iso(minute):
    moment = datetime(2000, 1, 1, tzinfo=timezone.utc) + timedelta(minutes=minute)
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def month_of(minute):
    moment = datetime(2000, 1, 1, tzinfo=timezone.utc) + timedelta(minutes=minute)
    return f"{moment.year}-{moment.month:02d}"


def pack_flags(satellite, fire_type, daynight):
    return satellite | (fire_type << 3) | (daynight << 6)


def unpack_flags(flags):
    return flags & 7, (flags >> 3) & 7, (flags >> 6) & 3


def confidence_label(source_id, code):
    if get_source(source_id).confidence_scheme == "percent":
        return str(code)
    return VIIRS_CONFIDENCE_LABELS.get(code, "?")


def confidence_class(source_id, code):
    if get_source(source_id).confidence_scheme == "percent":
        return "low" if code < 30 else "nominal" if code < 80 else "high"
    return {101: "low", 102: "nominal", 103: "high"}.get(code, "unknown")


class BlockBuilder:
    """Collects packed records per (month, tile) for one source and year."""

    def __init__(self):
        self.buckets = defaultdict(bytearray)

    def add(self, month, tile, record):
        self.buckets[(month, tile)] += record

    def months(self):
        return sorted({month for month, _ in self.buckets})

    def finalize_month(self, month, grid=None, source_id=None, cell_degrees=0.25):
        """Return (blocks, stats) for the month with duplicates removed and rows sorted by time."""
        blocks, total, duplicates, first, last = {}, 0, 0, None, None
        satellites = set()
        for (bucket_month, tile), buffer in sorted(self.buckets.items()):
            if bucket_month != month:
                continue
            rows = list(RECORD.iter_unpack(bytes(buffer)))
            unique = sorted({(row[0], row[1], row[2], row[4]): row for row in rows}.values(), key=lambda row: (row[2], row[0], row[1], row[4]))
            duplicates += len(rows) - len(unique)
            total += len(unique)
            first = unique[0][2] if first is None else min(first, unique[0][2])
            last = unique[-1][2] if last is None else max(last, unique[-1][2])
            satellites.update(unpack_flags(row[4])[0] for row in unique)
            if grid is not None:
                columns, rows_ = round(360 / cell_degrees), round(180 / cell_degrees)
                for row in unique:
                    x = min(int((row[1] / SCALE + 180) // cell_degrees), columns - 1)
                    y = min(int((row[0] / SCALE + 90) // cell_degrees), rows_ - 1)
                    flags = row[4]
                    entry = grid[(month, x, y, FIRE_TYPES[min((flags >> 3) & 7, 4)], confidence_class(source_id, row[5]))]
                    entry[0] += 1
                    if isfinite(row[3]):
                        entry[1] += row[3]
                    else:
                        entry[2] += 1
            payload = b"".join(RECORD.pack(*row) for row in unique)
            blocks[tile] = (zlib.compress(payload, 6), len(unique))
        return blocks, {
            "count": total,
            "duplicates": duplicates,
            "firstMinute": first,
            "lastMinute": last,
            "satellites": [SATELLITES[index] for index in sorted(satellites)],
        }

    def drop_month(self, month):
        for key in [key for key in self.buckets if key[0] == month]:
            del self.buckets[key]


def month_path(root, source_id, month):
    return Path(root) / source_id / month[:4] / f"{month}.pcd"


def write_month(root, source_id, month, blocks, stats, archive_sha256):
    """Write one month atomically and return its manifest entry."""
    offset, index, body = 0, {}, []
    for tile, (data, count) in sorted(blocks.items()):
        index[str(tile)] = [offset, len(data), count]
        body.append(data)
        offset += len(data)
    header = {
        "format": FORMAT_VERSION,
        "source": source_id,
        "month": month,
        "tileDegrees": TILE_DEGREES,
        "recordFormat": RECORD.format,
        "recordBytes": RECORD.size,
        "epoch": "2000-01-01T00:00:00Z",
        "scale": SCALE,
        "satellites": list(SATELLITES),
        "fireTypes": list(FIRE_TYPES),
        "daynight": list(DAYNIGHT),
        "confidenceCodes": "MODIS: percent 0-100; VIIRS: 101=l, 102=n, 103=h",
        "archiveSha256": archive_sha256,
        "blocks": index,
        **stats,
    }
    header_bytes = json.dumps(header, separators=(",", ":")).encode("utf-8")
    path = month_path(root, source_id, month)
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(".part")
    digest = hashlib.sha256()
    with partial.open("wb") as handle:
        for chunk in (MAGIC, struct.pack("<I", len(header_bytes)), header_bytes, *body):
            handle.write(chunk)
            digest.update(chunk)
    partial.replace(path)
    return {
        "month": month,
        "file": path.relative_to(Path(root)).as_posix(),
        "sha256": digest.hexdigest(),
        "bytes": path.stat().st_size,
        "count": stats["count"],
        "duplicates": stats["duplicates"],
        "firstObserved": None if stats["firstMinute"] is None else minute_to_iso(stats["firstMinute"]),
        "lastObserved": None if stats["lastMinute"] is None else minute_to_iso(stats["lastMinute"]),
        "satellites": stats["satellites"],
    }


class StoreError(RuntimeError):
    pass


def source_coverage(store_dir, source_id):
    """Latest committed archive manifest entry per year."""
    manifest = Path(store_dir) / source_id / "manifest.jsonl"
    years = {}
    if manifest.exists():
        for line in manifest.read_text(encoding="utf-8").splitlines():
            entry = json.loads(line)
            if entry.get("detections_format") == FORMAT_VERSION:
                years[entry["year"]] = entry
    return dict(sorted(years.items()))


def read_header(path):
    with Path(path).open("rb") as handle:
        if handle.read(4) != MAGIC:
            raise StoreError(f"{path}: not a pcd1 file")
        (length,) = struct.unpack("<I", handle.read(4))
        header = json.loads(handle.read(length))
        return header, 8 + length


def iter_tiles(path, tiles, start_minute, end_minute):
    """Yield raw records (latE5, lonE5, minute, frp, flags, conf) from the listed tiles within [start, end)."""
    header, base = read_header(path)
    if header["recordFormat"] != RECORD.format:
        raise StoreError(f"{path}: unsupported record format {header['recordFormat']}")
    with Path(path).open("rb") as handle:
        for tile in tiles:
            entry = header["blocks"].get(str(tile))
            if entry is None:
                continue
            handle.seek(base + entry[0])
            data = zlib.decompress(handle.read(entry[1]))
            if len(data) != entry[2] * RECORD.size:
                raise StoreError(f"{path}: corrupt tile {tile}")
            for record in RECORD.iter_unpack(data):
                if start_minute <= record[2] < end_minute:
                    yield record


def decode(record, source_id):
    lat_e5, lon_e5, minute, frp, flags, conf = record
    satellite, fire_type, daynight = unpack_flags(flags)
    lat, lon = lat_e5 / SCALE, lon_e5 / SCALE
    key = f"{source_id}|{lat}|{lon}|{minute_to_iso(minute)}|{SATELLITES[satellite]}"
    return {
        "id": hashlib.sha256(key.encode()).hexdigest()[:24],
        "source": source_id,
        "lat": lat,
        "lon": lon,
        "observedAt": minute_to_iso(minute),
        "minute": minute,
        "frpMw": None if not isfinite(frp) else round(float(frp), 3),
        "satellite": SATELLITES[satellite],
        "fireType": FIRE_TYPES[min(fire_type, len(FIRE_TYPES) - 1)],
        "daynight": DAYNIGHT[min(daynight, len(DAYNIGHT) - 1)],
        "confidenceRaw": confidence_label(source_id, conf),
        "confidenceClass": confidence_class(source_id, conf),
    }


class RowDecoder:
    """Fast validating decoder of archive rows into packed records."""

    def __init__(self, header, source_id):
        source = get_source(source_id)
        names = [name.strip().lstrip("﻿") for name in header]
        missing = [name for name in REQUIRED_COLUMNS[source.sensor] if name not in names]
        if missing:
            raise StoreError(f"FIRMS schema mismatch for {source_id}; missing {', '.join(missing)}")
        index = {name: position for position, name in enumerate(names)}
        self.width = len(names)
        self.lat, self.lon = index["latitude"], index["longitude"]
        self.date, self.time = index["acq_date"], index["acq_time"]
        self.sat, self.conf, self.frp = index["satellite"], index["confidence"], index["frp"]
        self.daynight = index["daynight"]
        self.type = index.get("type")
        self.percent = source.confidence_scheme == "percent"
        self.days = {}
        self.warnings = set()

    def day_number(self, text):
        cached = self.days.get(text)
        if cached is None:
            if len(text) != 10:
                raise ValueError
            cached = (date.fromisoformat(text) - EPOCH).days
            self.days[text] = cached
        return cached

    def decode(self, row):
        """Return (month, tile, packed, meta) or raise ValueError(reason)."""
        if len(row) != self.width:
            raise ValueError("column_count")
        try:
            lat, lon = float(row[self.lat]), float(row[self.lon])
        except ValueError:
            raise ValueError("coordinate") from None
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise ValueError("coordinate")
        try:
            text, clock = row[self.date].strip(), row[self.time].strip()
            if len(clock) > 4 or not clock.isdigit():
                raise ValueError
            clock = clock.zfill(4)
            hours, minutes = int(clock[:2]), int(clock[2:])
            if hours > 23 or minutes > 59:
                raise ValueError
            minute = self.day_number(text) * 1440 + hours * 60 + minutes
        except ValueError:
            raise ValueError("timestamp") from None
        raw = row[self.conf].strip()
        try:
            if self.percent:
                value = float(raw)
                if not 0 <= value <= 100:
                    raise ValueError
                conf = int(round(value))
            else:
                conf = VIIRS_CONFIDENCE_CODES[raw.lower()]
        except (ValueError, KeyError):
            raise ValueError("confidence") from None
        raw_frp = row[self.frp].strip()
        try:
            frp = float(raw_frp) if raw_frp else nan
        except ValueError:
            raise ValueError("frp") from None
        if frp == frp and (not isfinite(frp) or frp < 0):
            raise ValueError("frp")
        satellite_text = row[self.sat].strip()
        satellite = SATELLITE_CODES.get(satellite_text.upper())
        if satellite is None:
            satellite = len(SATELLITES) - 1
            self.warnings.add(f"unknown satellite code: {satellite_text}")
        if self.type is None:
            fire_type = len(FIRE_TYPES) - 1
        else:
            fire_type = TYPE_CODES.get(row[self.type].strip())
            if fire_type is None:
                raise ValueError("fire_type")
        flag = row[self.daynight].strip().upper()
        daynight = 0 if flag == "D" else 1 if flag == "N" else 2
        day = minute // 1440
        moment = EPOCH + timedelta(days=day)
        month = f"{moment.year}-{moment.month:02d}"
        packed = RECORD.pack(round(lat * SCALE), round(lon * SCALE), minute, frp, pack_flags(satellite, fire_type, daynight), conf)
        return month, tile_of(lon, lat), packed, (lat, lon, fire_type, conf, frp)
