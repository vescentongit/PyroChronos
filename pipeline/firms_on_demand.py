"""Bounded request-scoped FIRMS snapshots. No raw data or credentials are persisted."""

import csv
import hashlib
import io
import json
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone

from area_query import Polygon
from detection_store import minute_of
from firms_catalog import area_url
from firms_ingest import chunks
from firms_parse import RowParser
from reference_baseline import reference_window, support
from research_adapter import load_default_harmonization, month_window

SOURCES = ("MODIS_SP", "VIIRS_SNPP_SP")
MAX_BODY = 4_000_000
MAX_TOTAL_BYTES = 24_000_000
MAX_RECORDS = 150_000
MAX_CALLS = 512


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def download(url, timeout):
    """Never include a keyed URL or upstream body in an exception/log."""
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "PyroChronos-pipeline"})
        with urllib.request.build_opener(NoRedirect).open(request, timeout=timeout) as response:
            body = response.read(MAX_BODY + 1)
            if len(body) > MAX_BODY:
                raise ValueError("CAPACITY_LIMIT")
            return body
    except urllib.error.HTTPError as error:
        raise ValueError("RATE_LIMITED" if error.code == 429 else "UPSTREAM_DENIED" if error.code in (401, 403) else "DEPENDENCY_UNAVAILABLE") from None
    except urllib.error.URLError as error:
        raise ValueError("TIMEOUT" if isinstance(error.reason, TimeoutError) else "NETWORK_ERROR") from None
    except TimeoutError:
        raise ValueError("TIMEOUT") from None
    except OSError:
        raise ValueError("NETWORK_ERROR") from None


def availability(body):
    reader = csv.DictReader(io.StringIO(body.decode("utf-8-sig")))
    if not {"data_id", "min_date", "max_date"} <= set(reader.fieldnames or []):
        raise ValueError("DEPENDENCY_UNAVAILABLE")
    result = {}
    for row in reader:
        if row["data_id"] in SOURCES:
            first, last = date.fromisoformat(row["min_date"][:10]), date.fromisoformat(row["max_date"][:10])
            if first > last or row["data_id"] in result:
                raise ValueError("DEPENDENCY_UNAVAILABLE")
            result[row["data_id"]] = (first, last)
    if set(result) != set(SOURCES):
        raise ValueError("DEPENDENCY_UNAVAILABLE")
    return result


class Snapshot:
    """Store protocol backed by original parsed observations and explicit fetched intervals."""

    def __init__(self, polygon, records, receipts, ranges, availability_sha, baseline_requested):
        self.polygon = polygon
        self.records = sorted(records, key=lambda item: (item["minute"], item["source"], item["id"]))
        self.receipts = sorted(receipts, key=lambda item: (item["source"], item["start"], item["bbox"]))
        self.ranges = ranges
        self.provenance = {"kind": "firms-area-snapshot-1", "geometryHash": polygon.geometry_hash(),
                           "availabilitySha256": availability_sha, "baselineRequested": baseline_requested,
                           "sourcePolicy": "standard-processing-only; NRT is never substituted",
                           "availability": {sid: [a.isoformat(), b.isoformat()] for sid, (a, b) in ranges.items()},
                           "responses": self.receipts}
        # Raw response checksums bind even successful empty windows and reference observations.
        self._fingerprint = "sha256:" + digest(self.provenance)

    def fingerprint(self):
        return self._fingerprint

    def query(self, source_id, polygon, start, end, include=None):
        if polygon.geometry_hash() != self.polygon.geometry_hash():
            raise ValueError("SNAPSHOT_AREA_CHANGED")
        for item in self.records:
            if item["source"] == source_id and start <= item["observedAt"][:10] <= end and (include is None or include(item)):
                yield item

    def source_coverage(self, source_id):
        receipts = [item for item in self.receipts if item["source"] == source_id]
        years = {}
        for item in receipts:
            first, last = date.fromisoformat(item["start"]), date.fromisoformat(item["end"])
            for year in range(first.year, last.year + 1):
                years.setdefault(year, []).append(item)
        result = {}
        for year, entries in years.items():
            records = [item for item in self.records if item["source"] == source_id and item["observedAt"].startswith(str(year))]
            result[year] = {"sha256": digest(entries), "first_observed": records[0]["observedAt"] if records else None,
                            "last_observed": records[-1]["observedAt"] if records else None, "detections": len(records),
                            "fetched_intervals": [[item["start"], item["end"]] for item in entries],
                            "months": []}
        return result


def prepare(data, key, fetch=None, deadline_seconds=95):
    """Fetch at most one primary/comparison calendar month plus its actual reference windows."""
    if not key:
        raise ValueError("DEPENDENCY_UNAVAILABLE")
    fetch = fetch or download
    deadline = time.monotonic() + deadline_seconds
    polygon = Polygon(data["area"]["geometry"], max_vertices=501)
    selected = [data["period"]] + ([data["comparisonPeriod"]] if data["comparisonPeriod"] else [])
    for period in selected:
        first, last = date.fromisoformat(period["start"]), date.fromisoformat(period["end"])
        if first > last or first.strftime("%Y-%m") != last.strftime("%Y-%m"):
            raise ValueError("CAPACITY_LIMIT")
    body = fetch(f"https://firms.modaps.eosdis.nasa.gov/api/data_availability/csv/{key}/ALL", 10)
    ranges = availability(body)
    windows = {sid: set() for sid in SOURCES}
    for period in selected:
        for sid in SOURCES:
            windows[sid].add((date.fromisoformat(period["start"]), date.fromisoformat(period["end"])))
    model, _ = load_default_harmonization(data["baseline"]["windowYears"])
    baseline_requested = data.get("includeBaseline", True) and model is not None and support(polygon, model)[0]
    if baseline_requested:
        first, last, _ = month_window(data["period"]["start"][:7], data["period"])
        for year in range(first.year - data["baseline"]["windowYears"], first.year):
            windows["VIIRS_SNPP_SP"].add(reference_window(first, last, year))
    plan = []
    for sid, periods in windows.items():
        # Merge overlapping requested intervals without fetching the gaps between reference years.
        merged = []
        for first, last in sorted(periods):
            first, last = max(first, ranges[sid][0]), min(last, ranges[sid][1])
            if first > last:
                continue
            if merged and first <= merged[-1][1] + timedelta(days=1):
                merged[-1] = (merged[-1][0], max(last, merged[-1][1]))
            else:
                merged.append((first, last))
        for first, last in merged:
            for start, days in chunks(first, last):
                for bbox in polygon.bbox_pieces():
                    plan.append((sid, start, days, bbox))
    if len(plan) > MAX_CALLS:
        raise ValueError("CAPACITY_LIMIT")
    receipts, records, total_bytes = [], {}, len(body)

    def fetch_piece(piece):
        sid, start, days, bbox = piece
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise ValueError("DEPENDENCY_UNAVAILABLE")
        body = fetch(area_url(key, sid, bbox, days, start.isoformat()), min(10, remaining))
        end = start + timedelta(days=days)
        window = (datetime.combine(start, datetime.min.time(), timezone.utc), datetime.combine(end, datetime.min.time(), timezone.utc))
        text = body.decode("utf-8-sig")
        # Empty bytes/error text are not successful zero-observation responses. Require the CSV header.
        if not text.strip():
            raise ValueError("DEPENDENCY_UNAVAILABLE")
        reader = csv.reader(io.StringIO(text))
        parser = RowParser(next(reader), sid, window)
        records = []
        for line, row in enumerate(reader, 2):
            if not any(cell.strip() for cell in row):
                continue
            record, reject = parser.parse(row, line)
            if reject or record["outside_window"]:
                raise ValueError("DEPENDENCY_UNAVAILABLE")
            records.append(record)
            if len(records) > MAX_RECORDS:
                raise ValueError("CAPACITY_LIMIT")
        receipt = {"source": sid, "start": start.isoformat(), "end": (end - timedelta(days=1)).isoformat(),
                   "bbox": list(bbox), "sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body),
                   "rows": len(records), "status": "success"}
        return receipt, records

    executor = ThreadPoolExecutor(max_workers=6)
    futures = [executor.submit(fetch_piece, item) for item in plan]
    try:
        for future in as_completed(futures, timeout=max(0.01, deadline - time.monotonic())):
            receipt, parsed = future.result()
            receipts.append(receipt)
            total_bytes += receipt["bytes"]
            if total_bytes > MAX_TOTAL_BYTES:
                raise ValueError("CAPACITY_LIMIT")
            for record in parsed:
                if not polygon.contains(record["lon"], record["lat"]):
                    continue
                item = {"id": record["id"], "source": record["source"], "lat": record["lat"], "lon": record["lon"],
                        "observedAt": record["observed_at"], "minute": minute_of(datetime.fromisoformat(record["observed_at"])),
                        "confidenceRaw": record["confidence_raw"], "confidenceClass": record["confidence_class"],
                        "frpMw": record["frp_mw"], "satellite": record["satellite"], "fireType": record["fire_type"] or "unknown",
                        "daynight": record["daynight"], "productVersion": record["product_version"]}
                previous = records.get(item["id"])
                if previous is not None and previous != item:
                    raise ValueError("DEPENDENCY_UNAVAILABLE")
                records[item["id"]] = item
                if len(records) > MAX_RECORDS:
                    raise ValueError("CAPACITY_LIMIT")
    finally:
        executor.shutdown(wait=True, cancel_futures=True)
    return Snapshot(polygon, list(records.values()), receipts, ranges, hashlib.sha256(body).hexdigest(), baseline_requested)
