"""Safe, idempotent FIRMS job orchestration. No raw exception escapes this API."""
import hashlib
import json
import os
import time
from datetime import date, datetime, timedelta, timezone
from datetime import time as day_time
from uuid import UUID, uuid4

from firms import (
    CONFIG,
    VALIDATOR_VERSION,
    FirmsTransport,
    SafeFailure,
    region_bbox,
    validate_csv,
)


def utc_now():
    return datetime.now(timezone.utc)


class IngestService:
    def __init__(self, batches, storage, transport=None, validator=validate_csv, log=None,
                 validator_version=VALIDATOR_VERSION):
        self.batches, self.storage = batches, storage
        self.transport = transport or FirmsTransport()
        self.validator = validator
        self.validator_version = validator_version
        self.log = log or (lambda record: None)

    async def ingest(self, region_id, source_id, start, days=1, request_id=None):
        began = time.monotonic()
        batch_id, claimed = None, False
        safe_region = region_id if type(region_id) is str and region_id in CONFIG["regions"] else None
        safe_source = source_id if type(source_id) is str and source_id in CONFIG["sources"] else None

        def result(status="FAILED", code=None, retryable=False):
            if status not in ("PENDING", "FETCHED", "VALID", "EMPTY", "REJECTED", "FAILED"):
                status, code, retryable = "FAILED", "DATABASE_FAILED", True
            if code is not None:
                safe_failure = SafeFailure(code, retryable)
                code, retryable = safe_failure.code, safe_failure.retryable
            output = {"batchId": batch_id, "status": status, "errorCode": code, "retryable": retryable}
            record = {key: value for key, value in {
                "batchId": batch_id, "regionId": safe_region, "sourceId": safe_source,
                "status": status, "duration": round((time.monotonic() - began) * 1000),
                "errorCode": code,
            }.items() if value is not None}
            try:
                self.log(record)
            except Exception:
                pass  # Logging availability cannot turn committed data into failure.
            return output

        if safe_region is None:
            return result(code="REGION_NOT_ALLOWED")
        if safe_source is None:
            return result(code="SOURCE_NOT_ALLOWED")
        if type(start) is not date or type(days) is not int or not 1 <= days <= 5:
            return result(code="INVALID_REQUEST")
        if request_id is not None and type(request_id) is not str:
            return result(code="INVALID_REQUEST")
        try:
            end = start + timedelta(days=days)
            batch_id = str(uuid4()) if request_id is None else str(UUID(request_id))
            if request_id is not None and batch_id != request_id:
                return result(code="INVALID_REQUEST")
        except (ValueError, TypeError, AttributeError, OverflowError):
            batch_id = None
            return result(code="INVALID_REQUEST")
        key = os.environ.get("FIRMS_MAP_KEY", "")
        if not key or len(key) > 256 or not key.isascii() or any(c.isspace() for c in key):
            return result(code="CONFIG_MISSING")
        region, source = CONFIG["regions"][region_id], CONFIG["sources"][source_id]
        record = {
            "id": batch_id, "sourceId": source_id, "sourceManifestVersion": CONFIG["manifestVersion"],
            "processingLevel": source["processingLevel"], "productVersion": None,
            "regionId": region_id, "boundaryVersion": region["boundaryVersion"],
            "regionConfigChecksum": hashlib.sha256(json.dumps(region, sort_keys=True, separators=(",", ":")).encode()).hexdigest(),
            "requestBbox": region_bbox(region),
            "requestedStart": datetime.combine(start, day_time(), timezone.utc),
            "requestedEnd": datetime.combine(end, day_time(), timezone.utc),
            "fetchStartedAt": utc_now(), "status": "PENDING",
        }
        try:
            claimed, existing = await self.batches.claim(record)
        except Exception:
            return result(code="DATABASE_FAILED", retryable=True)
        if not claimed:
            scope = ("sourceId", "sourceManifestVersion", "regionId", "regionConfigChecksum",
                     "requestedStart", "requestedEnd")
            if any(existing[field] != record[field] for field in scope):
                return result(code="IDEMPOTENCY_CONFLICT")
            status = existing["status"]
            if status in ("PENDING", "FETCHED"):
                return result(status, "IN_PROGRESS", True)
            return result(status, existing.get("errorCode"), existing.get("retryable") or False)
        http_status = None
        try:
            payload, http_status = await self.transport.fetch(key, source_id, region, start, days)
        except SafeFailure as exc:
            return await self._fail(batch_id, exc, result)
        except Exception:
            return await self._fail(batch_id, SafeFailure("UPSTREAM_UNAVAILABLE", True), result)
        try:
            stored = await self.storage.put(batch_id, payload)
        except Exception:
            return await self._fail(batch_id, SafeFailure("STORAGE_FAILED", True, http_status), result)
        try:
            await self.batches.update(batch_id, {**stored, "status": "FETCHED", "httpStatus": http_status, "fetchedAt": utc_now()})
        except Exception:
            return await self._fail(batch_id, SafeFailure("DATABASE_FAILED", True, http_status), result)
        try:
            count = self.validator(payload, source, region)
            if type(count) is not int or count < 0:
                raise SafeFailure("INVALID_RESPONSE")
            status, code, retryable = ("EMPTY" if count == 0 else "VALID"), None, None
        except Exception:
            count, status, code, retryable = None, "REJECTED", "INVALID_RESPONSE", False
        try:
            await self.batches.update(batch_id, {"status": status, "completedAt": utc_now(),
                "validatorVersion": self.validator_version, "rowCount": count, "errorCode": code,
                "retryable": retryable, "validationSummary": {"scope": "csv-envelope-and-core-fields"}})
        except Exception:
            return await self._fail(batch_id, SafeFailure("DATABASE_FAILED", True, http_status), result)
        return result(status, code, retryable or False)

    async def _fail(self, batch_id, failure, result):
        try:
            await self.batches.update(batch_id, {"status": "FAILED", "completedAt": utc_now(),
                "errorCode": failure.code, "retryable": failure.retryable, "httpStatus": failure.http_status})
        except Exception:
            return result(code="DATABASE_FAILED", retryable=True)
        return result(code=failure.code, retryable=failure.retryable)
