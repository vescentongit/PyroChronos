"""Worker orchestration tests; no real dataset, credentials or publication service."""
import asyncio
import importlib.util
import json
import traceback
import unittest
from datetime import datetime, timezone

if importlib.util.find_spec("research_p1_worker"):
    from research_jobs import ResearchClaim, WorkerFailure, WorkerPolicy
    from research_p1_worker import ResearchWorker
else:
    ResearchWorker = None


class FakeQueue:
    def __init__(self, policy, claim):
        self.policy, self.pending = policy, claim
        self.alive, self.result_id = True, None
        self.failures, self.heartbeats = [], 0

    async def claim(self):
        value, self.pending = self.pending, None
        return value

    async def heartbeat(self, claim):
        self.heartbeats += 1
        return self.alive

    async def published_result(self, claim):
        return self.result_id

    async def fail(self, claim, code, retryable):
        self.failures.append((code, retryable))
        return "retry_scheduled" if retryable else "failed"


class ResearchWorkerTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.assertIsNotNone(ResearchWorker, "Research worker is not implemented")
        self.policy = WorkerPolicy(lease_seconds=0.2, heartbeat_seconds=0.02,
                                   process_timeout_seconds=0.15, retry_base_seconds=0.01,
                                   retry_max_seconds=0.02)
        self.claim = ResearchClaim("synthetic-job", "synthetic-workspace", "synthetic-attempt", 1,
                                   "33333333-3333-4333-8333-333333333333", {"synthetic": True},
                                   datetime(2026, 11, 11, tzinfo=timezone.utc))
        self.queue = FakeQueue(self.policy, self.claim)

    async def test_idle_does_not_call_processor(self):
        self.queue.pending = None

        async def process(claim):
            self.fail("Idle queue invoked a processor")

        self.assertEqual((await ResearchWorker(self.queue, process).run_once())["status"], "idle")

    async def test_heartbeat_runs_while_processing_and_success_requires_committed_result(self):
        async def process(claim):
            await asyncio.sleep(0.06)
            self.queue.result_id = "synthetic-result"

        result = await ResearchWorker(self.queue, process).run_once()
        self.assertEqual(result["status"], "succeeded")
        self.assertEqual(result["resultId"], "synthetic-result")
        self.assertGreaterEqual(self.queue.heartbeats, 1)
        self.assertEqual(self.queue.failures, [])

    async def test_return_without_publication_fails_closed(self):
        async def process(claim):
            pass

        result = await ResearchWorker(self.queue, process).run_once()
        self.assertEqual(result["status"], "failed")
        self.assertEqual(self.queue.failures, [("PUBLICATION_NOT_CONFIRMED", False)])

    async def test_processor_timeout_cancels_work_and_schedules_retry(self):
        cancelled = asyncio.Event()

        async def process(claim):
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        result = await ResearchWorker(self.queue, process).run_once()
        self.assertEqual(result["status"], "retry_scheduled")
        self.assertTrue(cancelled.is_set())
        self.assertEqual(self.queue.failures, [("PROCESS_TIMEOUT", True)])

    async def test_lost_lease_cancels_processor_without_mutating_new_owner(self):
        cancelled = asyncio.Event()
        self.queue.alive = False

        async def process(claim):
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.set()

        result = await ResearchWorker(self.queue, process).run_once()
        self.assertEqual(result["status"], "lease_lost")
        self.assertTrue(cancelled.is_set())
        self.assertEqual(self.queue.failures, [])

    async def test_publication_racing_with_heartbeat_is_recognized_as_success(self):
        async def process(claim):
            self.queue.result_id, self.queue.alive = "synthetic-result", False
            await asyncio.sleep(0.05)

        result = await ResearchWorker(self.queue, process).run_once()
        self.assertEqual(result["status"], "succeeded")
        self.assertEqual(self.queue.failures, [])

    async def test_external_cancellation_releases_attempt_for_retry_and_propagates(self):
        started = asyncio.Event()

        async def process(claim):
            started.set()
            await asyncio.Event().wait()

        task = asyncio.create_task(ResearchWorker(self.queue, process).run_once())
        await started.wait()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertEqual(self.queue.failures, [("WORKER_CANCELLED", True)])

    async def test_untrusted_processor_errors_never_leak_to_result_or_logs(self):
        secret = "private-test-credential-sentinel"
        records = []

        async def process(claim):
            raise RuntimeError(secret)

        result = await ResearchWorker(self.queue, process, log=records.append).run_once()
        self.assertEqual(result["status"], "retry_scheduled")
        self.assertNotIn(secret, json.dumps([result, records]))
        self.assertNotIn(self.claim.lease_token, json.dumps([result, records]))
        self.assertEqual(self.queue.failures, [("PROCESSOR_FAILED", True)])

    async def test_database_heartbeat_failure_stops_processing_and_preserves_recovery(self):
        async def broken_heartbeat(claim):
            raise WorkerFailure("DATABASE_FAILED", True)

        self.queue.heartbeat = broken_heartbeat

        async def process(claim):
            await asyncio.Event().wait()

        result = await ResearchWorker(self.queue, process).run_once()
        self.assertEqual(result["status"], "database_unavailable")
        self.assertEqual(self.queue.failures, [])

    async def test_shutdown_event_cancels_active_work_without_claiming_more_jobs(self):
        started, stop = asyncio.Event(), asyncio.Event()

        async def process(claim):
            started.set()
            await asyncio.Event().wait()

        task = asyncio.create_task(ResearchWorker(self.queue, process).run(stop))
        await started.wait()
        stop.set()
        await asyncio.wait_for(task, 1)
        self.assertEqual(self.queue.failures, [("WORKER_CANCELLED", True)])

    def test_invalid_policies_and_missing_processor_fail_before_claim(self):
        for values in ({"lease_seconds": 0}, {"heartbeat_seconds": 60}, {"max_attempts": True},
                       {"process_timeout_seconds": float("inf")}, {"retry_base_seconds": -1}):
            with self.assertRaises(ValueError):
                WorkerPolicy(**values)
        with self.assertRaises(ValueError):
            ResearchWorker(self.queue, None)
        error = WorkerFailure("private-sentinel", True)
        self.assertEqual(str(error), "PROCESSOR_FAILED")
        self.assertNotIn("private-sentinel", "".join(traceback.format_exception(error)))
