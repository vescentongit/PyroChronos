"""FIRMS source catalogue, archive locations and area presets for the PyroChronos pipeline."""

from dataclasses import dataclass

API_BASE = "https://firms.modaps.eosdis.nasa.gov/api/area/csv"
ARCHIVE_URL = "https://firms.modaps.eosdis.nasa.gov/data/country/zips/{prefix}_{year}_all_countries.zip"
MAX_DAY_RANGE = 5
CATALOG_VERSION = "firms-catalog-2"


@dataclass(frozen=True)
class Source:
    id: str
    sensor: str
    platform: str
    nominal_resolution_m: int
    processing: str
    confidence_scheme: str
    first_year: int
    archive_prefix: str | None = None


SOURCES = {
    s.id: s
    for s in (
        Source("MODIS_SP", "MODIS", "Terra/Aqua", 1000, "standard", "percent", 2000, "modis"),
        Source("MODIS_NRT", "MODIS", "Terra/Aqua", 1000, "nrt", "percent", 2000),
        Source("VIIRS_SNPP_SP", "VIIRS", "Suomi NPP", 375, "standard", "class", 2012, "viirs-snpp"),
        Source("VIIRS_SNPP_NRT", "VIIRS", "Suomi NPP", 375, "nrt", "class", 2012),
        Source("VIIRS_NOAA20_SP", "VIIRS", "NOAA-20", 375, "standard", "class", 2018, "viirs-jpss1"),
        Source("VIIRS_NOAA20_NRT", "VIIRS", "NOAA-20", 375, "nrt", "class", 2018),
        Source("VIIRS_NOAA21_NRT", "VIIRS", "NOAA-21", 375, "nrt", "class", 2023),
    )
}

REQUIRED_COLUMNS = {
    "MODIS": ("latitude", "longitude", "brightness", "acq_date", "acq_time", "satellite", "confidence", "version", "frp", "daynight"),
    "VIIRS": ("latitude", "longitude", "bright_ti4", "acq_date", "acq_time", "satellite", "confidence", "version", "frp", "daynight"),
}

WORLD = (-180.0, -90.0, 180.0, 90.0)
BOUNDARY_VERSION = "study-rectangle-v1"
FEATURED_REGIONS = {
    "kalteng": (113.0, -3.6, 115.0, -1.5),
    "papua": (139.5, -8.8, 141.0, -7.5),
}


def get_source(source_id):
    try:
        return SOURCES[source_id]
    except KeyError:
        raise ValueError(f"Unknown FIRMS source: {source_id}") from None


def parse_bbox(value):
    try:
        west, south, east, north = (float(part) for part in value.split(","))
    except ValueError:
        raise ValueError("bbox must be west,south,east,north") from None
    if not (-180 <= west <= 180 and -180 <= east <= 180 and -90 <= south < north <= 90) or west == east:
        raise ValueError("bbox out of range; west > east crosses the antimeridian")
    return (west, south, east, north)


def resolve_area(area):
    """Return (area_id, bbox) for a featured region id, 'world', or 'w,s,e,n'."""
    if area == "world":
        return "world", WORLD
    if area in FEATURED_REGIONS:
        return area, FEATURED_REGIONS[area]
    bbox = parse_bbox(area)
    return "bbox_" + "_".join(f"{v:g}" for v in bbox), bbox


def inside(lon, lat, bbox):
    west, south, east, north = bbox
    if not south <= lat <= north:
        return False
    return west <= lon <= east if west <= east else lon >= west or lon <= east


def area_url(key, source_id, bbox, day_range, start_date):
    get_source(source_id)
    if not 1 <= day_range <= MAX_DAY_RANGE:
        raise ValueError(f"day_range must be 1..{MAX_DAY_RANGE}")
    west, south, east, north = bbox
    return f"{API_BASE}/{key}/{source_id}/{west},{south},{east},{north}/{day_range}/{start_date}"


def archive_url(source_id, year):
    source = get_source(source_id)
    if not source.archive_prefix:
        raise ValueError(f"{source_id} has no yearly archive; use an _SP source")
    if year < source.first_year:
        raise ValueError(f"{source_id} starts in {source.first_year}")
    return ARCHIVE_URL.format(prefix=source.archive_prefix, year=year)


def redact(url, key):
    return url.replace(key, "<MAP_KEY>") if key else url
