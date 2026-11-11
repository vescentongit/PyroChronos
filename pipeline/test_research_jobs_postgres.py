"""Opt-in native PostgreSQL tests with independent sessions and shipped migrations."""
import asyncio
import importlib.util
import json
import os
import traceback
import unittest
from pathlib import Path
from uuid import uuid4

if importlib.util.find_spec("research_jobs"):
    from research_jobs import PostgresResearchQueue, WorkerFailure, WorkerPolicy
    from research_p1_worker import ResearchWorker
else:
    PostgresResearchQueue = None

TEST_DSN = os.environ.get("RESEARCH_TEST_DATABASE_URL")
ROOT = Path(__file__).resolve().parents[1]


@unittest.skipUnless(TEST_DSN, "Set RESEARCH_TEST_DATABASE_URL to a dedicated localhost test database")
class NativeResearchQueueTests(unittest.IsolatedAsyncioTestCase):
    loop_factory = asyncio.SelectorEventLoop

    async def asyncSetUp(self):
        self.assertIsNotNone(PostgresResearchQueue, "PostgreSQL research queue is not implemented")
        import psycopg
        from psycopg.conninfo import conninfo_to_dict
        from psycopg.rows import dict_row

        settings = conninfo_to_dict(TEST_DSN)
        if settings.get("host") not in {"127.0.0.1", "localhost", "::1"} or settings.get("dbname") != "research_worker_test":
            self.fail("Native integration tests require the dedicated localhost research_worker_test database")
        self.connection = await psycopg.AsyncConnection.connect(TEST_DSN, autocommit=True, row_factory=dict_row)
        self.addAsyncCleanup(self.connection.close)
        self.schema = f"research_test_{uuid4().hex}"
        await self.connection.execute(f'CREATE SCHEMA "{self.schema}"')
        self.addAsyncCleanup(self.connection.execute, f'DROP SCHEMA "{self.schema}" CASCADE')
        await self.connection.execute(f'SET search_path TO "{self.schema}", public')
        for path in sorted((ROOT / "prisma/migrations").glob("*/migration.sql")):
            await self.connection.execute(path.read_text(encoding="utf-8"), prepare=False)
        self.other = await psycopg.AsyncConnection.connect(TEST_DSN, autocommit=True, row_factory=dict_row)
        self.addAsyncCleanup(self.other.close)
        await self.other.execute(f'SET search_path TO "{self.schema}", public')
        self.policy = WorkerPolicy(lease_seconds=0.2, heartbeat_seconds=0.025,
                                   process_timeout_seconds=1, retry_base_seconds=0.04,
                                   retry_max_seconds=0.08, max_attempts=2)
        self.queue = PostgresResearchQueue(self.connection, self.policy)
        self.other_queue = PostgresResearchQueue(self.other, self.policy)
        self.examples = json.loads((ROOT / "docs/contracts/api-v2.examples.json").read_text(encoding="utf-8"))["examples"]

    async def seed(self):
        request_id, job_id = str(uuid4()), str(uuid4())
        payload = self.examples["result"]
        request = {**self.examples["analysis-create"], "requestId": request_id, "monitoringLocationId": None}
        frozen = {
            "area": payload["area"], "request": request,
            "versions": {"dataVersion": payload["dataVersion"], "modelVersion": payload["method"]["version"],
                         "satelliteConfigVersion": "synthetic-satellites-1", "aggregationVersion": "synthetic-aggregation-1"},
            "baselinePolicy": {"version": payload["baseline"]["policyVersion"], "minimumValidYears": 10},
        }
        await self.connection.execute('''INSERT INTO "P1AnalysisJob"
            ("id", "workspaceId", "requestedById", "requestId", "analysisKey", "areaId", "areaRevision", "input")
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb)''',
            [job_id, payload["workspaceId"], "synthetic-actor", request_id, "sha256:" + "a" * 64,
             payload["area"]["id"], payload["area"]["revision"], json.dumps(frozen)])
        return job_id

    async def job(self, job_id):
        return await (await self.connection.execute('SELECT * FROM "P1AnalysisJob" WHERE "id"=%s', [job_id])).fetchone()

    async def attempts(self, job_id):
        return await (await self.connection.execute('SELECT * FROM "P1AnalysisJobAttempt" WHERE "jobId"=%s ORDER BY "attemptNo"', [job_id])).fetchall()

    async def test_two_sessions_race_for_one_job_without_a_duplicate_claim(self):
        job_id = await self.seed()
        claims = await asyncio.gather(self.queue.claim(), self.other_queue.claim())
        self.assertEqual(sum(claim is not None for claim in claims), 1)
        self.assertEqual(len(await self.attempts(job_id)), 1)
        self.assertEqual((await self.job(job_id))["status"], "running")

    async def test_claim_deadline_is_the_database_value_at_millisecond_precision(self):
        job_id = await self.seed()
        policy = WorkerPolicy(lease_seconds=0.200123, heartbeat_seconds=0.025)
        claim = await PostgresResearchQueue(self.connection, policy).claim()
        self.assertEqual(claim.lease_expires_at, (await self.attempts(job_id))[0]["leaseExpiresAt"])

    async def test_skip_locked_claims_another_job_instead_of_waiting(self):
        first, second = await self.seed(), await self.seed()
        async with self.connection.transaction():
            await self.connection.execute('SELECT "id" FROM "P1AnalysisJob" WHERE "id"=%s FOR UPDATE', [first])
            claim = await asyncio.wait_for(self.other_queue.claim(), 0.5)
            self.assertEqual(claim.job_id, second)
        self.assertEqual((await self.queue.claim()).job_id, first)

    async def test_expired_lease_is_retained_and_reclaimed_with_a_new_token(self):
        job_id = await self.seed()
        first = await self.queue.claim()
        await asyncio.sleep(0.23)
        second = await self.other_queue.claim()
        self.assertEqual(second.job_id, job_id)
        self.assertEqual(second.attempt_no, 2)
        self.assertNotEqual(first.lease_token, second.lease_token)
        history = await self.attempts(job_id)
        self.assertEqual([row["status"] for row in history], ["expired", "running"])
        self.assertEqual(history[0]["errorCode"], "LEASE_EXPIRED")
        self.assertFalse(await self.queue.heartbeat(first))
        self.assertIsNone(await self.queue.fail(first, "PROCESSOR_FAILED", True))

    async def test_expired_owner_cannot_renew_even_before_another_worker_claims(self):
        await self.seed()
        first = await self.queue.claim()
        await asyncio.sleep(0.23)
        self.assertFalse(await self.queue.heartbeat(first))
        self.assertEqual((await self.attempts(first.job_id))[0]["leaseExpiresAt"], first.lease_expires_at)

    async def test_heartbeat_cannot_revive_lease_that_expires_between_check_and_update(self):
        await self.seed()
        claim = await self.queue.claim()
        original_now = self.queue._now

        async def delayed_now():
            await asyncio.sleep(0.23)
            return await original_now()

        self.queue._now = delayed_now
        self.assertFalse(await self.queue.heartbeat(claim))
        self.assertEqual((await self.attempts(claim.job_id))[0]["leaseExpiresAt"], claim.lease_expires_at)

    async def test_failure_cannot_rewrite_attempt_after_lease_expires_during_operation(self):
        await self.seed()
        claim = await self.queue.claim()
        original_now = self.queue._now

        async def delayed_now():
            await asyncio.sleep(0.23)
            return await original_now()

        self.queue._now = delayed_now
        self.assertIsNone(await self.queue.fail(claim, "PROCESSOR_FAILED", True))
        self.assertEqual((await self.attempts(claim.job_id))[0]["status"], "running")

    async def test_heartbeat_extends_lease_and_blocks_reclaim(self):
        await self.seed()
        first = await self.queue.claim()
        await asyncio.sleep(0.1)
        self.assertTrue(await self.queue.heartbeat(first))
        await asyncio.sleep(0.12)
        self.assertIsNone(await self.other_queue.claim())
        self.assertGreater((await self.attempts(first.job_id))[0]["leaseExpiresAt"], first.lease_expires_at)

    async def test_retry_obeys_backoff_and_preserves_terminal_attempts(self):
        job_id = await self.seed()
        first = await self.queue.claim()
        self.assertEqual(await self.queue.fail(first, "PROCESSOR_FAILED", True), "retry_scheduled")
        self.assertIsNone(await self.other_queue.claim())
        await asyncio.sleep(0.06)
        second = await self.other_queue.claim()
        self.assertEqual(second.attempt_no, 2)
        self.assertEqual((await self.attempts(job_id))[0]["status"], "failed")
        self.assertEqual(await self.other_queue.fail(second, "PROCESSOR_FAILED", True), "failed")
        self.assertEqual((await self.job(job_id))["status"], "failed")
        self.assertIsNone(await self.queue.claim())

    async def test_latest_retry_backoff_is_rechecked_after_parent_lock(self):
        policy = WorkerPolicy(lease_seconds=3, heartbeat_seconds=0.1,
                              process_timeout_seconds=4, retry_base_seconds=1,
                              retry_max_seconds=10, max_attempts=3)
        self.queue.policy = self.other_queue.policy = policy
        job_id = await self.seed()
        first = await self.queue.claim()
        await self.queue.fail(first, "PROCESSOR_FAILED", True)
        await asyncio.sleep(1.05)
        original_one = self.queue._one

        async def delayed_query(sql, params=()):
            # Widen the native MVCC snapshot-to-parent-lock race without mocking SQL.
            if "SELECT j.* FROM" in sql:
                sql = sql.replace("SELECT j.* FROM", "SELECT j.*, pg_sleep(0.2) AS delay FROM")
            return await original_one(sql, params)

        self.queue._one = delayed_query
        racing = asyncio.create_task(self.queue.claim())
        try:
            await asyncio.sleep(0.05)
            second = await self.other_queue.claim()
            self.assertEqual(second.attempt_no, 2)
            self.assertEqual(await self.other_queue.fail(second, "PROCESSOR_FAILED", True), "retry_scheduled")
            self.assertIsNone(await asyncio.wait_for(racing, 2))
            self.assertEqual(len(await self.attempts(job_id)), 2)
        finally:
            racing.cancel()
            await asyncio.gather(racing, return_exceptions=True)

    async def test_expired_retry_budget_marks_job_failed_without_fabricating_result(self):
        job_id = await self.seed()
        await self.queue.claim()
        await asyncio.sleep(0.23)
        await self.other_queue.claim()
        await asyncio.sleep(0.23)
        self.assertIsNone(await self.queue.claim())
        job = await self.job(job_id)
        self.assertEqual(job["status"], "failed")
        self.assertIsNone(job["resultId"])
        self.assertEqual([row["status"] for row in await self.attempts(job_id)], ["expired", "expired"])

    async def test_nonretryable_failure_is_terminal(self):
        job_id = await self.seed()
        claim = await self.queue.claim()
        self.assertEqual(await self.queue.fail(claim, "PUBLICATION_NOT_CONFIRMED", False), "failed")
        self.assertIsNone(await self.other_queue.claim())
        self.assertFalse((await self.job(job_id))["error"]["retryable"])

    async def test_old_completed_attempt_cannot_claim_the_replacement_publication(self):
        await self.seed()
        first = await self.queue.claim()
        await self.other.execute('''UPDATE "P1AnalysisJobAttempt" SET "status"='succeeded',
            "completedAt"=date_trunc('milliseconds', clock_timestamp()) WHERE "id"=%s''', [first.attempt_id])
        await asyncio.sleep(0.23)
        second = await self.other_queue.claim()
        await self.publish_fixture(second)
        self.assertIsNone(await self.queue.published_result(first))
        self.assertIsNotNone(await self.other_queue.published_result(second))

    async def test_claim_rolls_back_and_sanitizes_database_exceptions(self):
        job_id = await self.seed()
        await self.connection.execute('''CREATE FUNCTION reject_claim() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN RAISE EXCEPTION 'private-credential-sentinel'; END; $$;
            CREATE TRIGGER reject_claim BEFORE INSERT ON "P1AnalysisJobAttempt" FOR EACH ROW EXECUTE FUNCTION reject_claim();''', prepare=False)
        with self.assertRaises(WorkerFailure) as caught:
            await self.queue.claim()
        self.assertNotIn("private-credential-sentinel", "".join(traceback.format_exception(caught.exception)))
        self.assertIsNone(caught.exception.__context__)
        self.assertEqual((await self.job(job_id))["status"], "queued")
        self.assertEqual(await self.attempts(job_id), [])

    async def test_worker_maintains_lease_until_fixture_publication_commits(self):
        await self.seed()

        async def synthetic_processor(claim):
            await asyncio.sleep(0.3)
            await self.publish_fixture(claim)

        result = await ResearchWorker(self.queue, synthetic_processor).run_once()
        self.assertEqual(result["status"], "succeeded")
        self.assertIsNone(await self.other_queue.claim())

    async def publish_fixture(self, claim):
        # A test-only publisher. Production publication remains the next step.
        async with self.other.transaction():
            await self.other.execute('SELECT "id" FROM "P1AnalysisJob" WHERE "id"=%s FOR UPDATE', [claim.job_id])
            now = (await (await self.other.execute("SELECT date_trunc('milliseconds', clock_timestamp()) AS now")).fetchone())["now"]
            payload = json.loads(json.dumps(self.examples["result"]))
            payload.update(id=str(uuid4()), jobId=claim.job_id, workspaceId=claim.workspace_id,
                           generatedAt=now.isoformat(timespec="milliseconds"), publishedAt=now.isoformat(timespec="milliseconds"))
            manifest_id = str(uuid4())
            payload["method"]["manifestId"] = manifest_id
            manifest = {"schemaVersion": "research-manifest-1", "id": manifest_id, "jobId": claim.job_id,
                        "workspaceId": claim.workspace_id, "dataVersion": payload["dataVersion"]}
            await self.other.execute('''UPDATE "P1AnalysisJobAttempt" SET "status"='succeeded', "completedAt"=%s
                WHERE "id"=%s AND "leaseToken"=%s AND "leaseExpiresAt">clock_timestamp()''', [now, claim.attempt_id, claim.lease_token])
            await self.other.execute('''INSERT INTO "AnalysisManifest" ("id","jobId","workspaceId","dataVersion","checksum","content")
                VALUES (%s,%s,%s,%s,%s,%s::jsonb)''', [manifest_id, claim.job_id, claim.workspace_id, payload["dataVersion"], "sha256:" + "a" * 64, json.dumps(manifest)])
            await self.other.execute('''INSERT INTO "AnalysisResult" ("id","jobId","workspaceId","manifestId","dataVersion","generatedAt","publishedAt","payload")
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s::jsonb)''', [payload["id"], claim.job_id, claim.workspace_id, manifest_id, payload["dataVersion"], now, now, json.dumps(payload)])
            await self.other.execute('''UPDATE "P1AnalysisJob" SET "status"='succeeded', "resultId"=%s, "completedAt"=%s WHERE "id"=%s''', [payload["id"], now, claim.job_id])
