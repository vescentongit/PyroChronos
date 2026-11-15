"""Credential-bearing transport stays in the job, outside browser/UI contracts."""
import asyncio
import csv
import io
import json
import logging
import math
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

import httpx

CONFIG = json.loads((Path(__file__).resolve().parents[1] / "config/firms.json").read_text())
MAX_BYTES = 5 * 1024 * 1024
VALIDATOR_VERSION = "firms-envelope-v1"
ERROR_CODES = frozenset({
    "CONFIG_MISSING", "REGION_NOT_ALLOWED", "SOURCE_NOT_ALLOWED", "INVALID_REQUEST",
    "UPSTREAM_TIMEOUT", "UPSTREAM_REDIRECT", "UPSTREAM_RATE_LIMITED", "UPSTREAM_DENIED",
    "UPSTREAM_UNAVAILABLE", "INVALID_RESPONSE", "PAYLOAD_TOO_LARGE", "STORAGE_FAILED",
    "DATABASE_FAILED", "IDEMPOTENCY_CONFLICT", "IN_PROGRESS",
})


class SafeFailure(Exception):
    def __init__(self, code, retryable=False, http_status=None):
        if type(code) is not str or code not in ERROR_CODES:
            code, retryable = "UPSTREAM_UNAVAILABLE", True
        super().__init__(code)
        self.code = code
        self.retryable = retryable if type(retryable) is bool else False
        self.http_status = http_status if type(http_status) is int and 100 <= http_status <= 599 else None


class _NoTransportLogs(logging.Filter):
    def filter(self, record):
        return False


# httpx logs full URLs at INFO; httpcore may log response headers at DEBUG.
# Suppress those emitters, not the application's allowlisted operational log.
for _name in ("httpx", "httpcore.connection", "httpcore.http11", "httpcore.http2",
              "httpcore.proxy", "httpcore.socks", "httpcore.connection_pool"):
    logging.getLogger(_name).addFilter(_NoTransportLogs())


def region_bbox(region):
    points = region["geometry"]["coordinates"][0]
    return [min(p[0] for p in points), min(p[1] for p in points),
            max(p[0] for p in points), max(p[1] for p in points)]


class FirmsTransport:
    def __init__(self, client=None, timeout_seconds=20, max_bytes=MAX_BYTES):
        self.client = client
        self.timeout_seconds, self.max_bytes = timeout_seconds, max_bytes

    async def fetch(self, key, source_id, region, start, days):
        """The deadline covers connect, headers and the entire streamed body."""
        failure = None
        try:
            async with asyncio.timeout(self.timeout_seconds):
                if self.client is None:
                    async with httpx.AsyncClient(follow_redirects=False, trust_env=False, timeout=None) as client:
                        return await self._fetch(client, key, source_id, region, start, days)
                return await self._fetch(self.client, key, source_id, region, start, days)
        except SafeFailure as exc:
            failure = SafeFailure(exc.code, exc.retryable, exc.http_status)
        except (TimeoutError, httpx.TimeoutException):
            failure = SafeFailure("UPSTREAM_TIMEOUT", True)
        except httpx.RemoteProtocolError:
            failure = SafeFailure("INVALID_RESPONSE", True)
        except Exception:
            failure = SafeFailure("UPSTREAM_UNAVAILABLE", True)
        # Raise outside the except block: no upstream URL in the exception chain.
        raise failure

    async def _fetch(self, client, key, source_id, region, start, days):
        box = ",".join(str(value) for value in region_bbox(region))
        url = ("https://firms.modaps.eosdis.nasa.gov/api/area/csv/"
               f"{quote(key, safe='')}/{source_id}/{box}/{days}/{start.isoformat()}")
        async with client.stream("GET", url, follow_redirects=False,
                                 headers={"Accept": "text/csv", "Accept-Encoding": "identity"}) as response:
            status = response.status_code
            if 300 <= status < 400:
                raise SafeFailure("UPSTREAM_REDIRECT", False, status)
            if status == 429:
                raise SafeFailure("UPSTREAM_RATE_LIMITED", True, status)
            if status in (401, 403):
                raise SafeFailure("UPSTREAM_DENIED", False, status)
            if status != 200:
                raise SafeFailure("UPSTREAM_UNAVAILABLE", status >= 500, status)
            encoding = response.headers.get("content-encoding", "identity").lower()
            if encoding not in ("identity", ""):
                raise SafeFailure("INVALID_RESPONSE", False, status)
            length = response.headers.get("content-length")
            if length is not None and (not length.isdecimal()):
                raise SafeFailure("INVALID_RESPONSE", False, status)
            if length is not None and int(length) > self.max_bytes:
                raise SafeFailure("PAYLOAD_TOO_LARGE", False, status)
            body = bytearray()
            # Only identity encoding is accepted, so iteration cannot inflate a
            # compressed response before the size check. Also handles buffered
            # responses supplied by HTTPX's test transport.
            async for chunk in response.aiter_bytes():
                if len(body) + len(chunk) > self.max_bytes:
                    raise SafeFailure("PAYLOAD_TOO_LARGE", False, status)
                body.extend(chunk)
            if length is not None and len(body) != int(length):
                raise SafeFailure("INVALID_RESPONSE", True, status)
            if any(token in body for token in (key.encode(), quote(key, safe="").encode())):
                raise SafeFailure("INVALID_RESPONSE", False, status)
            return bytes(body), status


def validate_csv(payload, source, region):
    """Envelope/core-field validation, not scientific quality or coverage approval.

    Nathan's parser can replace this callable; it receives the persisted bytes.
    No row or upstream error text is included in a validation exception.
    """
    valid = False
    count = 0
    try:
        text = payload.decode("utf-8-sig")
        if not text or "\x00" in text:
            raise ValueError
        rows = csv.reader(io.StringIO(text, newline=""), strict=True)
        header = next(rows)
        required = set(CONFIG["requiredColumns"])
        allowed = required | set(CONFIG["optionalColumns"])
        if len(set(header)) != len(header) or not required.issubset(header) or not set(header) <= allowed:
            raise ValueError
        for values in rows:
            if not values or len(values) != len(header):
                raise ValueError
            row = dict(zip(header, values, strict=True))
            lat, lon, frp = (float(row[field]) for field in ("latitude", "longitude", "frp"))
            if not all(math.isfinite(v) for v in (lat, lon, frp)) or not (-90 <= lat <= 90 and -180 <= lon <= 180) or frp < 0:
                raise ValueError
            west, south, east, north = region_bbox(region)
            if not (west <= lon <= east and south <= lat <= north):
                raise ValueError
            if len(row["acq_time"]) != 4 or not row["acq_time"].isdigit():
                raise ValueError
            if len(row["acq_date"]) != 10:
                raise ValueError
            datetime.strptime(row["acq_date"] + row["acq_time"], "%Y-%m-%d%H%M")
            if not row["satellite"] or not row["version"]:
                raise ValueError
            if source["sensor"] == "MODIS":
                confidence = float(row["confidence"])
                if not math.isfinite(confidence) or not 0 <= confidence <= 100:
                    raise ValueError
            elif row["confidence"].lower() not in {"l", "n", "h", "low", "nominal", "high"}:
                raise ValueError
            count += 1
        valid = True
    except (ValueError, UnicodeError, csv.Error, StopIteration, KeyError, OverflowError):
        pass
    if not valid:
        raise SafeFailure("INVALID_RESPONSE")
    return count
