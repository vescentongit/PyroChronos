"""Async worker supervisor; producer and atomic publisher are injected explicitly."""
import asyncio
from contextlib import suppress

from research_jobs import WorkerFailure


class ResearchWorker:
    def __init__(self, queue, processor, log=None):
        if not callable(processor):
            raise ValueError("An async research processor must be configured")
        self.queue, self.processor = queue, processor
        self.log = log or (lambda record: None)

    def _result(self, status, claim=None, code=None, result_id=None):
        value = {"status": status}
        if claim is not None:
            value.update(jobId=claim.job_id, attemptNo=claim.attempt_no)
        if code is not None:
            value["errorCode"] = WorkerFailure(code).code
        if result_id is not None:
            value["resultId"] = result_id
        try:
            self.log(dict(value))
        except Exception:
            pass
        return value

    async def _heartbeat(self, claim):
        while True:
            await asyncio.sleep(self.queue.policy.heartbeat_seconds)
            if not await self.queue.heartbeat(claim):
                raise WorkerFailure("LEASE_LOST")

    async def _execute(self, claim):
        await self.processor(claim)

    async def run_once(self):
        try:
            claim = await self.queue.claim()
        except WorkerFailure:
            return self._result("database_unavailable", code="DATABASE_FAILED")
        if claim is None:
            return self._result("idle")

        work = asyncio.create_task(self._execute(claim))
        heartbeat = asyncio.create_task(self._heartbeat(claim))
        failure = None
        cancelled = False
        try:
            async with asyncio.timeout(self.queue.policy.process_timeout_seconds):
                done, _ = await asyncio.wait({work, heartbeat}, return_when=asyncio.FIRST_COMPLETED)
                if heartbeat in done:
                    await heartbeat
                await work
        except asyncio.CancelledError:
            cancelled = True
            failure = WorkerFailure("WORKER_CANCELLED", True)
        except TimeoutError:
            failure = WorkerFailure("PROCESS_TIMEOUT", True)
        except WorkerFailure as error:
            failure = error
        except Exception:
            failure = WorkerFailure("PROCESSOR_FAILED", True)
        finally:
            for task in (work, heartbeat):
                task.cancel()
            await asyncio.gather(work, heartbeat, return_exceptions=True)

        try:
            result_id = await self.queue.published_result(claim)
            if result_id is not None:
                result = self._result("succeeded", claim, result_id=result_id)
            elif failure and failure.code in {"LEASE_LOST", "DATABASE_FAILED"}:
                result = self._result("lease_lost" if failure.code == "LEASE_LOST" else "database_unavailable",
                                      claim, failure.code)
            else:
                failure = failure or WorkerFailure("PUBLICATION_NOT_CONFIRMED")
                status = await self.queue.fail(claim, failure.code, failure.retryable)
                result = self._result(status or "lease_lost", claim, failure.code)
        except WorkerFailure:
            result = self._result("database_unavailable", claim, "DATABASE_FAILED")
        if cancelled:
            raise asyncio.CancelledError
        return result

    async def run(self, stop):
        while not stop.is_set():
            work = asyncio.create_task(self.run_once())
            stopping = asyncio.create_task(stop.wait())
            try:
                done, _ = await asyncio.wait({work, stopping}, return_when=asyncio.FIRST_COMPLETED)
                if stopping in done:
                    work.cancel()
                    with suppress(asyncio.CancelledError):
                        await work
                    return
                await work
            finally:
                for task in (work, stopping):
                    task.cancel()
                await asyncio.gather(work, stopping, return_exceptions=True)
            with suppress(TimeoutError):
                await asyncio.wait_for(stop.wait(), self.queue.policy.poll_seconds)
