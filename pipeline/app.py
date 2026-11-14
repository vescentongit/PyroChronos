"""Private, bounded WSGI adapter for the existing detection-store producer."""
import json
import os
from pathlib import Path
from threading import BoundedSemaphore

from research_worker import fingerprint, produce

MAX_REQUEST_BYTES = 100_000
MAX_RESPONSE_BYTES = 4_000_000
_running = BoundedSemaphore(1)


def _response(start_response, status, value):
    body = json.dumps(value, allow_nan=False, separators=(",", ":")).encode("utf-8")
    if len(body) > MAX_RESPONSE_BYTES:
        status, body = "503 Service Unavailable", b'{"code":"CAPACITY_LIMIT"}'
    start_response(status, [("Content-Type", "application/json"),
                            ("Cache-Control", "no-store"), ("Content-Length", str(len(body)))])
    return [body]


def app(environ, start_response):
    """Only app -> pipeline bindings may reach this service on Vercel."""
    def respond(status, value):
        return _response(start_response, status, value)

    path, method = environ.get("PATH_INFO"), environ.get("REQUEST_METHOD")
    if path == "/health" and method == "GET":
        return respond("200 OK", {"service": "pipeline", "status": "ok"})
    if path != "/produce":
        return respond("404 Not Found", {"code": "NOT_FOUND"})
    if method != "POST":
        return respond("405 Method Not Allowed", {"code": "METHOD_NOT_ALLOWED"})
    try:
        size = int(environ.get("CONTENT_LENGTH", "0"))
        if not 0 < size <= MAX_REQUEST_BYTES or environ.get("CONTENT_TYPE", "").split(";")[0].lower() != "application/json":
            raise ValueError("INVALID_REQUEST")
        request = json.loads(environ["wsgi.input"].read(size))
        if not isinstance(request, dict):
            raise ValueError("INVALID_REQUEST")
        if request.get("action") == "fingerprint":
            if set(request) != {"action"}:
                raise ValueError("INVALID_REQUEST")
        elif request.get("action") == "produce":
            if set(request) != {"action", "run"} or not isinstance(request["run"], dict):
                raise ValueError("INVALID_REQUEST")
            # Frozen P1 configs can reference files; they belong to the separate private queue worker.
            data = request["run"].get("input")
            if not isinstance(data, dict) or "producer" in data:
                raise ValueError("INVALID_REQUEST")
        else:
            raise ValueError("INVALID_REQUEST")
    except (ValueError, TypeError, KeyError, UnicodeError):
        return respond("400 Bad Request", {"code": "INVALID_REQUEST"})
    configured = os.environ.get("RESEARCH_DATA_DIR")
    remote = os.environ.get("FIRMS_BLOB_BASE_URL")
    if not configured and not remote:
        return respond("503 Service Unavailable", {"code": "DEPENDENCY_UNAVAILABLE"})
    if not _running.acquire(blocking=False):
        return respond("503 Service Unavailable", {"code": "CAPACITY_LIMIT"})
    try:
        if remote:
            from firms_blob import BlobDataset, PrivateBlob

            pinned = request["run"]["input"]["dataset"]["fingerprint"] if request["action"] == "produce" else None
            root = BlobDataset(PrivateBlob(), pinned)
        else:
            root = Path(configured)
            if not root.is_absolute():
                root = Path(__file__).resolve().parent / root
            if not root.is_dir():
                raise ValueError("MISSING_DATASET")
        value = fingerprint(root) if request["action"] == "fingerprint" else produce(root, request["run"])
        return respond("200 OK", value)
    except Exception as error:
        code = "CAPACITY_LIMIT" if str(error) == "CAPACITY_LIMIT" else "DEPENDENCY_UNAVAILABLE"
        return respond("503 Service Unavailable", {"code": code})
    finally:
        _running.release()
