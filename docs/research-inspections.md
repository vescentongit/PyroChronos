# R2-P1-B3: assignments, inspections, revisions and audit

The v2 workflow adds InspectionAssignment, P1InspectionReport,
P1InspectionReportRevision and InspectionAuditEvent. The legacy InspectionReport,
RawBatch and existing analysis/location evidence remain unchanged. The migration
only adds new enums, tables, indexes, foreign keys and inspection guard functions.
It must be applied as a separate deployment step, never during an HTTP request.

## API and authorization

All paths below have prefix `/api/v2/workspaces/:workspaceId`:

| Method | Path | Response |
|---|---|---|
| POST | /locations/:locationId/assignments | 201 assignment |
| GET | /locations/:locationId/assignments | 200 list |
| PATCH | /assignments/:assignmentId | 200 assignment |
| POST | /assignments/:assignmentId/reports | 201 report |
| GET | /locations/:locationId/reports | 200 list with corrections |
| PATCH | /reports/:reportId | 200 corrected report |

The existing strict research-2 schemas define requests and responses. Lists use
`{items,nextCursor}`, default limit 50, maximum 100, ordered by createdAt and ID.
Cursors are bound to the workspace, location and resource type.

The experimental v2 gate remains enabled only by RESEARCH_V2_EXPERIMENTAL=true.
Auth.js sessions and active P0 membership authorize every operation, including
cached retries. Any active member can assign another active member or record an
inspection for an active inspector in the same workspace. Inspector and recorder
may differ. The assignee, assigner or workspace owner may change assignment status;
only the original recorder or an active owner may correct a report.

Shared HTTP helpers supply private/no-store headers, origin validation and bounded
research-2 errors. Raw exceptions, DSNs, credentials and stack traces are not
returned or logged. Inputs and actor snapshots are checked for configured secrets
and credential-bearing URLs. Audit rows have explicit fields and contain neither
report notes nor raw request/response bodies.

## Status and evidence

Allowed transitions are assigned -> in_progress/completed/cancelled and
in_progress -> completed/cancelled. Terminal assignments cannot reopen; create a
new assignment for another inspection. Completion requires a stored report,
including an inconclusive outcome. Saving a report does not complete a task.
New reports require an active assignment; existing reports can be corrected after
completion/cancellation. None of these operations modifies the original location
anchor, AOI revision, initial result or later detection visibility.

observedAt is the inspection time and cannot be in the future. Persistence supports
millisecond precision; greater fractional precision is rejected rather than rounded
silently. Creation/correction times come from database clock_timestamp after locks
are acquired, so an older waiting transaction cannot regress the audit clock.

## Transactions and immutable history

Each write locks the workspace, checks current actor permissions, then locks the
assignment and report where necessary. Idempotency is checked before business-state
and expectedRevision validation, using workspace/actor/operation/resource scope.
Identical retries return the original response, even after later changes; different
payloads return 409 IDEMPOTENCY_CONFLICT. Stale revisions return 409 REVISION_CONFLICT;
illegal transitions return 400 INVALID_REQUEST. The shared 30/minute request guard
is inherited from P0 and returns private 429 responses with Retry-After.

Assignments retain an immutable identity and a guarded mutable status/revision
projection. Reports retain the immutable initial state; each correction appends a
new version. The response uses the newest state and reconstructs corrections from
each preceding state plus the following correction's actor, reason and time.
The initial recorder and createdAt never change. Snapshot identities remain stored
when membership is deactivated or display names change.

Composite foreign keys constrain resource scope, inspector, recorder and actor
memberships without cascading away evidence. Triggers forbid history UPDATE,
DELETE and TRUNCATE. Assignment guards enforce transitions and report requirements;
revision guards enforce contiguous version numbers. Deferred constraint triggers
require an exact audit event at commit and validate event lineage, actor, request,
time, revision and status. Event revision indexes prevent duplicate audit effects.
Creation/correction audit actor snapshots must equal the snapshots on their source
assignment, report or revision, preventing inconsistent names through direct SQL.
The business mutation, audit and idempotency receipt commit or roll back together.

## Verification boundaries

Tests cover transition rules, service/HTTP authorization, strict bodies, retries,
correction history, workspace isolation, secret protection and B2 regression.
Native PostgreSQL tests cover concurrent retries/conflicts, competing revisions,
delayed-transaction clocks, composite references, unaudited/forged changes,
immutability and rollback when audit insertion fails. Native tests require the
guarded localhost database research_worker_test through RESEARCH_TEST_DATABASE_URL,
and PYTHON pointing to an interpreter with psycopg. Missing configuration skips
native tests and is not native acceptance evidence.

There is no new public audit endpoint, AOI editing endpoint or P0-to-P1 submission
bridge. Producer integration, staging OAuth/HTTP acceptance, deployment migration
and workload/capacity benchmarks remain separate work. Fixture data is synthetic
and never becomes a production fallback.

Verification passed 178 Node tests and 131 Python tests without skips, including
eight B3 native PostgreSQL cases. Prisma validate/generate, typecheck, npm lint,
contract checks, production build and diff checks passed. Independent static review
found no blockers; its actor-snapshot hardening suggestion was reproduced with a
failing native test and fixed. Revision listing currently reads history per report;
batching that read remains a measured-performance improvement for later work.
