> **Keputusan aktif 13 November 2026:** seluruh fitur web tanpa login; Google OAuth bukan persyaratan. Penyimpanan pengguna lokal di browser. Ketentuan akun/kolaborasi server dan status implementasi di bawah merupakan konteks rencana/riwayat sebelumnya; untuk keputusan dan status terbaru ikuti [status aktif](current-status.md).

# R2-P1 Step 2: PostgreSQL worker, claims and leases

`pipeline/research_jobs.py` implements the queue over the Step 1 Prisma tables.
`pipeline/research_p1_worker.py` supervises an explicitly injected asynchronous
processor. This step does not implement the Nathan adapter or production
publication service; the integration tests use a publisher fixture inside their
isolated test schema.

## Queue protocol

Use a dedicated psycopg async connection with `dict_row`, `autocommit=True`, and
the correct database/schema. Do not share that connection with processor SQL or
other queue instances. Queue methods serialize their own connection operations.
Migrations are an explicit deployment step and are never run by the worker.

- `claim()` selects the oldest eligible job with `FOR UPDATE OF j SKIP LOCKED`.
  The same short transaction changes a queued job to running and inserts its
  attempt. The claim is returned only after commit. Two workers use separate
  connections; locked jobs are skipped rather than waited on.
  Eligibility is rechecked against the latest attempt after acquiring the parent
  lock, including retry backoff, because the scan snapshot may predate a claim
  and failure committed by another worker.
- A running job with an expired attempt can be reclaimed. The old attempt is
  retained as `expired`, with `LEASE_EXPIRED`, and the new attempt has a greater
  number and a new UUID token. An orphan completed attempt whose publication
  never committed can also be retried after its lease expires, without rewriting
  its terminal history. Job `startedAt` and frozen input never change on retry.
- `heartbeat(claim)` locks the job before its attempt, checks job/workspace,
  token, running state and the database deadline, then extends the lease.
  The update itself rechecks expiry so a deadline passing during the operation
  cannot revive an expired owner. It returns false when ownership is lost.
- `fail(claim, code, retryable)` is fenced the same way. A retryable failure
  closes the attempt but leaves the job running until exponential backoff has
  elapsed. A nonretryable failure or exhausted budget closes the job as failed,
  without inventing a result or resetting a terminal job.
- `published_result(claim)` recognizes success only for the matching token of
  the latest completed attempt and a succeeded job. An old attempt cannot claim
  another worker's publication as its own.

All deadlines and eligibility decisions use PostgreSQL time, with millisecond
precision for persisted timestamps. No client clock is trusted. Job/attempt
locks are released before producer work. Each operation has a local SQL
statement timeout. Driver failures are replaced after transaction cleanup by
bounded `WorkerFailure` codes without retaining credential-bearing exception
context. Ambiguous commits do not become synthetic successes; the persisted
lease/history governs recovery.

## Supervisor and processor boundary

```python
import asyncio
import psycopg
from psycopg.rows import dict_row

from research_jobs import PostgresResearchQueue, WorkerPolicy
from research_p1_worker import ResearchWorker


async def serve(dsn, processor, stop):
    async with await psycopg.AsyncConnection.connect(
        dsn, autocommit=True, row_factory=dict_row, connect_timeout=10
    ) as connection:
        queue = PostgresResearchQueue(connection, WorkerPolicy())
        await ResearchWorker(queue, processor).run(stop)


# Caller supplies DSN through private runtime configuration and an actual processor.
# On Windows use asyncio.Runner(loop_factory=asyncio.SelectorEventLoop).
```

`processor(claim)` receives the frozen input and private lease identity. It must
be asynchronous, cooperate with cancellation, avoid blocking the event loop,
and return only after the future publisher has committed the result. CPU-bound
analytics must run outside the heartbeat event loop, with cancellation of their
subprocess/executor owned by the adapter. Publisher operations must use a
separate connection and verify current ownership/deadline in their transaction.
The publication service must not trust the supervisor's earlier lease check.

The supervisor runs heartbeats concurrently, cancels the processor on lease
loss, and bounds processing time. Timeout or cooperative shutdown schedules a
retry while the worker still owns its lease. Database failure stops processing
and leaves recovery to the persisted lease. A callback that merely returns
without a committed publication fails as `PUBLICATION_NOT_CONFIRMED`.

Logging is allowlisted to status, jobId, attemptNo, resultId and bounded errorCode.
Input, tokens, DSNs, upstream URLs and exception messages are never logged. The
default logger does nothing; a logging failure cannot rewrite committed state.
The worker never loads `.env`, creates identities, or supplies demo data.

## Policy

`WorkerPolicy` is explicit constructor configuration. Defaults are an engineering
starting point, not a measured capacity/SLA: lease 60s, heartbeat 15s, processor
timeout 300s, maximum 3 attempts, retry delays 5s/10s/... capped at 60s, idle loop
poll 1s, SQL statement timeout 5s. Heartbeat must be less than half the lease.
Configure values for the runtime/producer before deployment. Retry timing comes
from the latest immutable attempt, so restarting a worker does not erase it.

## Tests

Unit tests cover orchestration, timeout/cancellation, lease loss, publication
races, configuration and secret-safe failures. Native integration tests execute
the production queue queries and shipped migrations against separate PostgreSQL
connections. They cover double claim, a deliberately locked oldest job, heartbeat
extension and expiry races, reclaim/retry/backoff/budget, transaction rollback,
and a synthetic processor that stays active longer than one lease.

Native tests are opt-in and require **localhost** and a database named exactly
`research_worker_test`. Every test creates and drops a random schema; no tables
are created in public and no production DSN is used. Missing test configuration
skips this suite, so an integration claim requires running with the variable set.

Example temporary PostgreSQL (synthetic password, no persistent volume):

```powershell
docker run --name pyrochronos-worker-test --rm -d -p 127.0.0.1:55432:5432 -e POSTGRES_USER=research_test -e POSTGRES_PASSWORD=synthetic-local-test-only -e POSTGRES_DB=research_worker_test postgres:16-alpine
$env:RESEARCH_TEST_DATABASE_URL = 'postgresql://research_test:synthetic-local-test-only@127.0.0.1:55432/research_worker_test'
.cache/ingest-venv/Scripts/python.exe -m unittest discover -s pipeline -v
.cache/ingest-venv/Scripts/ruff.exe check pipeline/research_jobs.py pipeline/research_p1_worker.py pipeline/test_research_worker.py pipeline/test_research_jobs_postgres.py
npm.cmd test
npm.cmd run typecheck
npm.cmd run check:contracts
docker stop pyrochronos-worker-test
```

Wait for PostgreSQL readiness before running tests. The test suite does not
provision Docker or install dependencies. It does not verify a hosted worker,
production roles, global archive processing, or scientific validity.
