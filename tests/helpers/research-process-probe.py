"""Synthetic process barriers over the real runtime and dedicated localhost queue."""
import asyncio
import json
import os
import signal
import sys
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "pipeline"))
import research_p1_runtime as runtime
from research_jobs import PostgresResearchQueue, WorkerFailure, WorkerPolicy

dsn, schema = runtime.connection_settings(os.environ["DATABASE_URL"])
url = urlsplit(dsn)
if url.hostname not in {"127.0.0.1", "localhost", "::1"} or url.path != "/research_worker_test" or not schema or not schema.startswith("publication_test_"):
    raise SystemExit("DEDICATED_TEST_DATABASE_REQUIRED")
mode = sys.argv[1]
policy = WorkerPolicy(lease_seconds=2, heartbeat_seconds=0.1,
                      process_timeout_seconds=0.4 if mode == "timeout" else 30,
                      retry_base_seconds=0.01, retry_max_seconds=0.01)
runtime.PostgresResearchQueue = lambda connection: PostgresResearchQueue(connection, policy)


async def process(claim):
    if mode == "crash":
        # Execute the authentic producer, but stop before invoking the publisher.
        await runtime.private_process([sys.executable, "pipeline/research_worker.py"], {
            "root": os.environ["RESEARCH_DATA_DIR"],
            "run": {"id": claim.job_id, "workspaceId": claim.workspace_id, "input": claim.input}})
    checkpoint = {"stage": "before-publication", "claim": {
        "jobId": claim.job_id, "workspaceId": claim.workspace_id,
        "attemptId": claim.attempt_id, "leaseToken": claim.lease_token}}
    if mode in {"crash", "transient"}:
        print(json.dumps(checkpoint), flush=True)
    if mode == "transient":
        raise WorkerFailure("PROCESSOR_FAILED", True)
    if mode == "crash":
        await asyncio.Event().wait()
    popen = runtime.subprocess.Popen

    def track(*args, **kwargs):
        child = popen(*args, **kwargs)
        print(json.dumps({**checkpoint, "childPid": child.pid}), flush=True)
        if mode == "signal":
            # Python dispatch on Windows; POSIX exercises the OS SIGTERM handler.
            if sys.platform == "win32":
                signal.raise_signal(signal.SIGTERM)
            else:
                os.kill(os.getpid(), signal.SIGTERM)
        return child

    runtime.subprocess.Popen = track
    await runtime.private_process([sys.executable, "-c", "import time; time.sleep(300)"], {})


runtime.process_claim = process
sys.argv.append("--once")
raise SystemExit(runtime.run())
