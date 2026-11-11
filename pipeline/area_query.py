"""Free-polygon queries over the original-detection store.

Polygons are GeoJSON-style WGS84 [longitude, latitude] with an exterior ring and optional holes.
Edges are straight lines in longitude/latitude space (planar), not geodesics. An edge longer than 180
degrees of longitude is read the short way across the antimeridian (RFC 7946 convention). A bbox prefilter
selects store tiles; every candidate is then tested against the real polygon, so results differ
from bbox-only queries. Points on a ring edge count as inside the exterior and as outside a hole.
Dates are inclusive UTC days.
"""

import hashlib
import json
from datetime import date
from math import cos, radians, sin

from detection_store import RECORD, SCALE, decode, day_start_minute, iter_tiles, month_path, tiles_for_bbox

EARTH_RADIUS_KM = 6371.0088
MAX_VERTICES = 10000
EPS = 1e-12


class GeometryError(ValueError):
    pass


def _ring(points, name):
    if len(points) < 4:
        raise GeometryError(f"{name}: ring needs at least four positions")
    ring = []
    for point in points:
        if len(point) != 2 or not all(isinstance(v, (int, float)) for v in point):
            raise GeometryError(f"{name}: positions must be [lon, lat]")
        lon, lat = float(point[0]), float(point[1])
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            raise GeometryError(f"{name}: coordinate out of range")
        ring.append((lon, lat))
    if ring[0] != ring[-1]:
        raise GeometryError(f"{name}: ring is not closed")
    if len(set(ring[:-1])) < 3:
        raise GeometryError(f"{name}: ring needs three distinct vertices")
    return ring


def _crosses(ring):
    return any(abs(b[0] - a[0]) > 180 for a, b in zip(ring, ring[1:]))


def _signed_area(ring):
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(ring, ring[1:])) / 2


def _segments_intersect(p1, p2, p3, p4):
    def orient(a, b, c):
        value = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
        return 0 if abs(value) < EPS else (1 if value > 0 else -1)

    def on_segment(a, b, c):
        return min(a[0], b[0]) - EPS <= c[0] <= max(a[0], b[0]) + EPS and min(a[1], b[1]) - EPS <= c[1] <= max(a[1], b[1]) + EPS

    o1, o2, o3, o4 = orient(p1, p2, p3), orient(p1, p2, p4), orient(p3, p4, p1), orient(p3, p4, p2)
    if o1 != o2 and o3 != o4:
        return True
    return (o1 == 0 and on_segment(p1, p2, p3)) or (o2 == 0 and on_segment(p1, p2, p4)) or (o3 == 0 and on_segment(p3, p4, p1)) or (o4 == 0 and on_segment(p3, p4, p2))


def _self_intersects(ring):
    segments = list(zip(ring, ring[1:]))
    count = len(segments)
    for i in range(count):
        for j in range(i + 1, count):
            adjacent = j == i + 1 or (i == 0 and j == count - 1)
            if adjacent:
                a, b = segments[i], segments[j]
                shared = b[0] if j == i + 1 else a[0]
                other_a = a[0] if j == i + 1 else a[1]
                other_b = b[1] if j == i + 1 else b[0]
                cross = (shared[0] - other_a[0]) * (other_b[1] - shared[1]) - (shared[1] - other_a[1]) * (other_b[0] - shared[0])
                if abs(cross) < EPS and (other_a[0] - shared[0]) * (other_b[0] - shared[0]) + (other_a[1] - shared[1]) * (other_b[1] - shared[1]) > 0:
                    return True
                continue
            if _segments_intersect(*segments[i], *segments[j]):
                return True
    return False


def _on_ring(lon, lat, ring):
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        cross = (x2 - x1) * (lat - y1) - (y2 - y1) * (lon - x1)
        if abs(cross) < 1e-10 and min(x1, x2) - 1e-10 <= lon <= max(x1, x2) + 1e-10 and min(y1, y2) - 1e-10 <= lat <= max(y1, y2) + 1e-10:
            return True
    return False


def _inside_ring(lon, lat, ring):
    inside = False
    for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
        if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


class Polygon:
    """Validated polygon with holes, prepared for repeated point tests."""

    def __init__(self, geometry, max_vertices=MAX_VERTICES, min_area_km2=0.0, max_area_km2=None):
        if not isinstance(geometry, dict) or geometry.get("type") != "Polygon":
            raise GeometryError("geometry must be a GeoJSON Polygon")
        rings = geometry.get("coordinates")
        if not rings or not isinstance(rings, list):
            raise GeometryError("polygon needs an exterior ring")
        if sum(len(r) for r in rings) > max_vertices:
            raise GeometryError(f"polygon exceeds {max_vertices} vertices")
        parsed = [_ring(r, "exterior" if i == 0 else f"hole {i}") for i, r in enumerate(rings)]
        self.crosses_antimeridian = any(_crosses(r) for r in parsed)
        if self.crosses_antimeridian:
            parsed = [[(lon + 360 if lon < 0 else lon, lat) for lon, lat in r] for r in parsed]
        for index, ring in enumerate(parsed):
            if abs(_signed_area(ring)) < 1e-12:
                raise GeometryError("ring has zero area")
            if _self_intersects(ring):
                raise GeometryError("exterior ring self-intersects" if index == 0 else f"hole {index} self-intersects")
        self.exterior, self.holes = parsed[0], parsed[1:]
        for index, hole in enumerate(self.holes, start=1):
            if not all(_inside_ring(lon, lat, self.exterior) or _on_ring(lon, lat, self.exterior) for lon, lat in hole[:-1]):
                raise GeometryError(f"hole {index} is not inside the exterior ring")
            for other in self.holes[index:]:
                if any(_segments_intersect(*a, *b) for a in zip(hole, hole[1:]) for b in zip(other, other[1:])) or any(_inside_ring(lon, lat, other) for lon, lat in hole[:-1]) or any(_inside_ring(lon, lat, hole) for lon, lat in other[:-1]):
                    raise GeometryError("holes overlap, touch or are nested")
            for a in zip(hole, hole[1:]):
                if any(_segments_intersect(*a, *b) for b in zip(self.exterior, self.exterior[1:])):
                    raise GeometryError(f"hole {index} touches the exterior ring")
        longitudes = [lon for lon, _ in self.exterior]
        latitudes = [lat for _, lat in self.exterior]
        self.west, self.east = min(longitudes), max(longitudes)
        self.south, self.north = min(latitudes), max(latitudes)
        self.area_km2 = self._area()
        if self.area_km2 <= min_area_km2:
            raise GeometryError("polygon area is too small")
        if max_area_km2 is not None and self.area_km2 > max_area_km2:
            raise GeometryError(f"polygon area exceeds {max_area_km2} km2")
        shown = [self._back(r) for r in [self.exterior, *self.holes]] if self.crosses_antimeridian else [self.exterior, *self.holes]
        self.geometry = {"type": "Polygon", "coordinates": [[[lon, lat] for lon, lat in ring] for ring in shown]}

    @staticmethod
    def _back(ring):
        return [((lon - 360) if lon > 180 else lon, lat) for lon, lat in ring]

    def _area(self):
        def spherical(ring):
            total = 0.0
            for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
                total += radians(x2 - x1) * (2 + sin(radians(y1)) + sin(radians(y2)))
            return abs(total) * EARTH_RADIUS_KM**2 / 2

        return spherical(self.exterior) - sum(spherical(hole) for hole in self.holes)

    def bbox_pieces(self):
        """Non-antimeridian bbox pieces (west, south, east, north) covering the polygon."""
        if self.east <= 180:
            return [(self.west, self.south, self.east, self.north)]
        pieces = []
        if self.west < 180:
            pieces.append((self.west, self.south, 180.0, self.north))
        pieces.append((-180.0, self.south, self.east - 360, self.north))
        return pieces

    def contains(self, lon, lat):
        if lat < self.south or lat > self.north:
            return False
        candidates = (lon, lon + 360) if self.crosses_antimeridian else (lon,)
        for x in candidates:
            if x < self.west or x > self.east:
                continue
            if _on_ring(x, lat, self.exterior):
                return True
            if not _inside_ring(x, lat, self.exterior):
                continue
            if any(_on_ring(x, lat, hole) or _inside_ring(x, lat, hole) for hole in self.holes):
                continue
            return True
        return False

    def canonical(self):
        return json.dumps(self.geometry, separators=(",", ":"))

    def geometry_hash(self):
        return "sha256:" + hashlib.sha256(self.canonical().encode()).hexdigest()


def period_minutes(start, end):
    """Inclusive UTC dates -> [start minute, exclusive end minute)."""
    first, last = date.fromisoformat(start), date.fromisoformat(end)
    if last < first:
        raise ValueError("period start after end")
    return day_start_minute(first), day_start_minute(last) + 1440


def months_between(start_minute, end_minute):
    from detection_store import month_of

    months, cursor = [], start_minute
    while cursor < end_minute:
        month = month_of(cursor)
        if not months or months[-1] != month:
            months.append(month)
        cursor += 1440
    return months


def query(store_dir, source_id, polygon, start, end, include=None):
    """Yield decoded detections inside the polygon between inclusive UTC dates, sorted by time.

    include: optional predicate on the decoded dict (quality policy). Months missing from the store
    are skipped here; use coverage in area_counts to see them explicitly.
    """
    start_minute, end_minute = period_minutes(start, end)
    rows = []
    for month in months_between(start_minute, end_minute):
        path = month_path(store_dir, source_id, month)
        if not path.exists():
            continue
        for west, south, east, north in polygon.bbox_pieces():
            tiles = tiles_for_bbox(west, south, east, north)
            for record in iter_tiles(path, tiles, start_minute, end_minute):
                lat, lon = record[0] / SCALE, record[1] / SCALE
                if lon < west or lon > east or lat < south or lat > north:
                    continue
                if polygon.contains(lon, lat):
                    rows.append(record)
    rows.sort(key=lambda r: (r[2], r[0], r[1], r[4]))
    for record in rows:
        item = decode(record, source_id)
        if include is None or include(item):
            yield item
