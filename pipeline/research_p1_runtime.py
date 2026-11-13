"""Private subprocess bridge between the P1 queue, Nathan producer and publisher."""
import asyncio
import json
import os
import re
import signal
import subprocess
import sys
import threading
from contextlib import suppress
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import psycopg
from psycopg import sql
from psycopg.rows import dict_row

from research_jobs import PostgresResearchQueue, WorkerFailure

ROOT = Path(__file__).resolve().parent.parent
MAX_MESSAGE = 100 * 1024 * 1024


async def private_process(args, request, limit=MAX_MESSAGE):
    payload = json.dumps(request, ensure_ascii=False, allow_nan=False).encode()
    if len(payload) > MAX_MESSAGE:
        raise WorkerFailure("PROCESSOR_FAILED")
    child = subprocess.Popen(args, cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0)

    def feed():
        with child.stdin:
            child.stdin.write(payload)

    feeding = asyncio.create_task(asyncio.to_thread(feed))
    try:
        chunks, size = [], 0
        while chunk := await asyncio.to_thread(child.stdout.read, 65536):
            size += len(chunk)
            if size > limit:
                raise WorkerFailure("PROCESSOR_FAILED")
            chunks.append(chunk)
        await feeding
        if await asyncio.to_thread(child.wait) != 0:
            raise WorkerFailure("PROCESSOR_FAILED", True)
        return json.loads(b"".join(chunks))
    finally:
        if child.poll() is None:
            with suppress(ProcessLookupError):
                child.kill()
        await asyncio.to_thread(child.wait)
        feeding.cancel()
        await asyncio.gather(feeding, return_exceptions=True)
        child.stdout.close()


async def process_claim(claim):
    root = os.environ.get("RESEARCH_DATA_DIR")
    if not root or not os.environ.get("RESEARCH_ARTIFACT_ROOT"):
        raise WorkerFailure("PROCESSOR_FAILED")
    bundle = await private_process([sys.executable, str(ROOT / "pipeline/research_worker.py")], {"root": root, "run": {"id": claim.job_id, "workspaceId": claim.workspace_id, "input": claim.input}})
    receipt = await private_process([os.environ.get("RESEARCH_NODE", "node"), str(ROOT / "scripts/research-p1-publish.mjs")], {"claim": {"jobId": claim.job_id, "workspaceId": claim.workspace_id, "attemptId": claim.attempt_id, "leaseToken": claim.lease_token}, "bundle": bundle}, limit=65536)
    if receipt.get("status") != "succeeded":
        raise WorkerFailure("PROCESSOR_FAILED", True)


def connection_settings(dsn):
    parts = urlsplit(dsn)
    query = dict(parse_qsl(parts.query))
    schema = query.pop("schema", None)
    for key in ("connection_limit", "pool_timeout", "pgbouncer"):
        query.pop(key, None)
    if schema is not None and not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", schema):
        raise ValueError("INVALID_SCHEMA")
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment)), schema


async def main(once=False):
    from research_p1_worker import ResearchWorker

    dsn, schema = connection_settings(os.environ["DATABASE_URL"])
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for event in (signal.SIGINT, signal.SIGTERM):
        signal.signal(event, lambda *_: loop.call_soon_threadsafe(stop.set))

    def control():
        message = b""
        with suppress(OSError, ValueError, RuntimeError):
            while len(message) < 64 and b"\n" not in message:
                chunk = os.read(sys.stdin.fileno(), 64 - len(message))
                if not chunk:
                    return
                message += chunk
            if message.strip() == b"stop":
                loop.call_soon_threadsafe(stop.set)

    threading.Thread(target=control, daemon=True).start()
    async with await psycopg.AsyncConnection.connect(dsn, autocommit=True, row_factory=dict_row, connect_timeout=10) as connection:
        if schema:
            await connection.execute(sql.SQL("SET search_path TO {}, public").format(sql.Identifier(schema)))
        worker = ResearchWorker(PostgresResearchQueue(connection), process_claim, lambda value: print(json.dumps(value), flush=True))
        if once:
            work, stopping = asyncio.create_task(worker.run_once()), asyncio.create_task(stop.wait())
            try:
                done, _ = await asyncio.wait({work, stopping}, return_when=asyncio.FIRST_COMPLETED)
                if stopping in done:
                    work.cancel()
                    with suppress(asyncio.CancelledError):
                        await work
                    return 0
                result = await work
                return 0 if result["status"] in {"idle", "succeeded"} else 1
            finally:
                stopping.cancel()
                await asyncio.gather(stopping, return_exceptions=True)
        await worker.run(stop)
    return 0


def run():
    try:
        if sys.platform == "win32":
            with asyncio.Runner(loop_factory=asyncio.SelectorEventLoop) as runner:
                return runner.run(main("--once" in sys.argv))
        return asyncio.run(main("--once" in sys.argv))
    except KeyboardInterrupt:
        return 0
    except Exception:
        print('{"status":"database_unavailable","errorCode":"DATABASE_FAILED"}', flush=True)
        return 1
