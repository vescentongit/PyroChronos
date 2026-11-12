"""PostgreSQL-backed claims and fenced leases for the Prisma-owned research queue."""
import asyncio
import json
import math
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import wraps
from uuid import uuid4

from psycopg.pq import TransactionStatus

FAILURE_CODES = frozenset({
    "DATABASE_FAILED", "LEASE_EXPIRED", "LEASE_LOST", "PROCESSOR_FAILED",
    "PROCESS_TIMEOUT", "WORKER_CANCELLED", "PUBLICATION_NOT_CONFIRMED", "RETRY_EXHAUSTED",
})


class WorkerFailure(Exception):
    def __init__(self, code, retryable=False):
        self.code = code if type(code) is str and code in FAILURE_CODES else "PROCESSOR_FAILED"
        self.retryable = retryable if type(retryable) is bool else False
        super().__init__(self.code)


def _database_operation(operation):
    @wraps(operation)
    async def safe(*args, **kwargs):
        try:
            return await operation(*args, **kwargs)
        except WorkerFailure as error:
            failure = WorkerFailure(error.code, error.retryable)
        except Exception:
            failure = WorkerFailure("DATABASE_FAILED", True)
        # Sanitize after context managers unwind so driver context is not retained.
        raise failure

    return safe


@dataclass(frozen=True)
class WorkerPolicy:
    lease_seconds: float = 60
    heartbeat_seconds: float = 15
    process_timeout_seconds: float = 300
    max_attempts: int = 3
    retry_base_seconds: float = 5
    retry_max_seconds: float = 60
    poll_seconds: float = 1
    database_timeout_seconds: float = 5

    def __post_init__(self):
        positive = (self.lease_seconds, self.heartbeat_seconds, self.process_timeout_seconds,
                    self.poll_seconds, self.database_timeout_seconds)
        nonnegative = (self.retry_base_seconds, self.retry_max_seconds)
        if (any(type(v) not in (int, float) or not math.isfinite(v) or v <= 0 for v in positive)
                or any(type(v) not in (int, float) or not math.isfinite(v) or v < 0 for v in nonnegative)
                or self.lease_seconds < 0.01 or self.heartbeat_seconds >= self.lease_seconds / 2
                or self.retry_max_seconds < self.retry_base_seconds
                or type(self.max_attempts) is not int or not 1 <= self.max_attempts <= 100):
            raise ValueError("Invalid research worker policy")


@dataclass(frozen=True)
class ResearchClaim:
    job_id: str
    workspace_id: str
    attempt_id: str
    attempt_no: int
    lease_token: str
    input: dict
    lease_expires_at: datetime


class PostgresResearchQueue:
    def __init__(self, connection, policy=None):
        if connection.autocommit is not True:
            raise ValueError("Research queue requires an autocommit connection")
        self.connection = connection
        self.policy = policy or WorkerPolicy()
        self._lock = asyncio.Lock()

    @asynccontextmanager
    async def _transaction(self):
        async with self._lock:
            if self.connection.info.transaction_status != TransactionStatus.IDLE:
                raise WorkerFailure("DATABASE_FAILED", True)
            async with self.connection.transaction():
                await self.connection.execute("SELECT set_config('statement_timeout', %s, true)",
                                              [str(max(1, int(self.policy.database_timeout_seconds * 1000)))])
                yield

    async def _one(self, sql, params=()):
        return await (await self.connection.execute(sql, params)).fetchone()

    async def _now(self):
        return (await self._one("SELECT date_trunc('milliseconds', clock_timestamp()) AS now"))["now"]

    def _eligible(self, latest, now):
        if latest is None:
            return True
        if latest["status"] in {"running", "succeeded"}:
            return latest["leaseExpiresAt"] <= now
        if latest["retryable"] is not True:
            return False
        if latest["status"] == "expired":
            return True
        if latest["status"] == "failed":
            delay = min(self.policy.retry_max_seconds,
                        self.policy.retry_base_seconds * 2 ** min(latest["attemptNo"] - 1, 20))
            return latest["completedAt"] + timedelta(seconds=delay) <= now
        return False

    @_database_operation
    async def claim(self):
        while True:
            exhausted = False
            async with self._transaction():
                job = await self._one('''SELECT j.* FROM "P1AnalysisJob" j
                    LEFT JOIN LATERAL (
                        SELECT * FROM "P1AnalysisJobAttempt" WHERE "jobId"=j."id"
                        ORDER BY "attemptNo" DESC LIMIT 1
                    ) a ON true
                    WHERE j."status"='queued' OR (j."status"='running' AND (
                        a."id" IS NULL
                        OR (a."status" IN ('running', 'succeeded') AND a."leaseExpiresAt"<=clock_timestamp())
                        OR (a."status"='expired' AND a."retryable" IS TRUE)
                        OR (a."status"='failed' AND a."retryable" IS TRUE AND
                            a."completedAt" + make_interval(secs => LEAST(%s::double precision,
                                %s::double precision * power(2, LEAST(a."attemptNo"-1, 20))))<=clock_timestamp())
                    )) ORDER BY j."createdAt", j."id" FOR UPDATE OF j SKIP LOCKED LIMIT 1''',
                    [self.policy.retry_max_seconds, self.policy.retry_base_seconds])
                if job is None:
                    return None
                latest = await self._one('''SELECT * FROM "P1AnalysisJobAttempt" WHERE "jobId"=%s
                    ORDER BY "attemptNo" DESC LIMIT 1''', [job["id"]])
                now = await self._now()
                # The scan snapshot may predate a newer failure; recheck its backoff too.
                if not self._eligible(latest, now):
                    continue
                if latest and latest["status"] == "running":
                    await self.connection.execute('''UPDATE "P1AnalysisJobAttempt" SET "status"='expired',
                        "completedAt"=%s, "errorCode"='LEASE_EXPIRED', "retryable"=true WHERE "id"=%s''',
                        [now, latest["id"]])
                attempt_no = latest["attemptNo"] + 1 if latest else 1
                if attempt_no > self.policy.max_attempts:
                    await self._fail_job(job["id"], now, "RETRY_EXHAUSTED")
                    exhausted = True
                else:
                    await self.connection.execute('''UPDATE "P1AnalysisJob" SET "status"='running',
                        "startedAt"=coalesce("startedAt", %s), "stage"='ingest', "progressPercent"=null WHERE "id"=%s''',
                        [now, job["id"]])
                    attempt_id, token = str(uuid4()), str(uuid4())
                    expires = now + timedelta(seconds=self.policy.lease_seconds)
                    stored = await self._one('''INSERT INTO "P1AnalysisJobAttempt"
                        ("id","jobId","workspaceId","attemptNo","leaseToken","claimedAt","heartbeatAt","leaseExpiresAt")
                        VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING "leaseExpiresAt"''',
                        [attempt_id, job["id"], job["workspaceId"], attempt_no, token, now, now, expires])
                    claim = ResearchClaim(job["id"], job["workspaceId"], attempt_id, attempt_no,
                                          token, job["input"], stored["leaseExpiresAt"])
            # Return only after the transaction commits; an ambiguous commit is not a claim.
            if not exhausted:
                return claim

    async def _owned(self, claim):
        job = await self._one('''SELECT "id" FROM "P1AnalysisJob" WHERE "id"=%s AND "workspaceId"=%s
            AND "status"='running' FOR UPDATE''', [claim.job_id, claim.workspace_id])
        if job is None:
            return None
        return await self._one('''SELECT * FROM "P1AnalysisJobAttempt" WHERE "id"=%s AND "jobId"=%s
            AND "workspaceId"=%s AND "leaseToken"=%s AND "status"='running'
            AND "leaseExpiresAt">clock_timestamp() FOR UPDATE''',
            [claim.attempt_id, claim.job_id, claim.workspace_id, claim.lease_token])

    @_database_operation
    async def heartbeat(self, claim):
        async with self._transaction():
            attempt = await self._owned(claim)
            if attempt is None:
                return False
            now = await self._now()
            expires = max(attempt["leaseExpiresAt"], now + timedelta(seconds=self.policy.lease_seconds))
            updated = await self._one('''UPDATE "P1AnalysisJobAttempt" SET "heartbeatAt"=%s,
                "leaseExpiresAt"=%s WHERE "id"=%s AND "leaseExpiresAt">clock_timestamp() RETURNING "id"''',
                [now, expires, claim.attempt_id])
            if updated is None:
                return False
        return True

    @_database_operation
    async def fail(self, claim, code, retryable):
        failure = WorkerFailure(code, retryable)
        async with self._transaction():
            attempt = await self._owned(claim)
            if attempt is None:
                return None
            now = await self._now()
            updated = await self._one('''UPDATE "P1AnalysisJobAttempt" SET "status"='failed',
                "completedAt"=%s, "errorCode"=%s, "retryable"=%s WHERE "id"=%s
                AND "leaseExpiresAt">clock_timestamp() RETURNING "id"''',
                [now, failure.code, failure.retryable, claim.attempt_id])
            if updated is None:
                return None
            if not failure.retryable or attempt["attemptNo"] >= self.policy.max_attempts:
                await self._fail_job(claim.job_id, now, failure.code)
                status = "failed"
            else:
                status = "retry_scheduled"
        return status

    async def _fail_job(self, job_id, now, code):
        error = {"schemaVersion": "research-2", "error": "Research processing did not complete.",
                 "code": "INTERNAL_ERROR", "retryable": False, "requestId": None}
        # Detailed bounded reason belongs to the attempt; API error keeps the v2 enum.
        if code == "DATABASE_FAILED":
            error["code"] = "DEPENDENCY_UNAVAILABLE"
        await self.connection.execute('''UPDATE "P1AnalysisJob" SET "status"='failed', "completedAt"=%s,
            "error"=%s::jsonb WHERE "id"=%s''', [now, json.dumps(error), job_id])

    @_database_operation
    async def published_result(self, claim):
        async with self._transaction():
            row = await self._one('''SELECT j."resultId" FROM "P1AnalysisJob" j
                JOIN "P1AnalysisJobAttempt" a ON a."jobId"=j."id" AND a."workspaceId"=j."workspaceId"
                WHERE j."id"=%s AND j."workspaceId"=%s AND j."status"='succeeded'
                  AND a."id"=%s AND a."leaseToken"=%s AND a."status"='succeeded'
                  AND NOT EXISTS (SELECT 1 FROM "P1AnalysisJobAttempt" newer
                      WHERE newer."jobId"=j."id" AND newer."attemptNo">a."attemptNo") ''',
                [claim.job_id, claim.workspace_id, claim.attempt_id, claim.lease_token])
            return row["resultId"] if row else None
