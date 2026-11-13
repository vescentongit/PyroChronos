# R2-P1-B2: persistent monitoring locations

The location service uses published P1 `AnalysisResult` and `P1AnalysisArtifact`
records. It does not read P0 `AnalysisArtifact` or bridge P0 submissions to P1.
The existing experimental v2 gate, Auth.js session, active workspace membership,
workspace lock, idempotency helper and safe research-2 error DTO remain in use.

## HTTP API

- `POST /api/v2/workspaces/:workspaceId/locations`: strict location-create DTO
  (`requestId`, `analysisId`, `anchorDetectionId`, `name`), returning 201 location.
- `GET /api/v2/workspaces/:workspaceId/locations`: `{ items, nextCursor }`, ordered
  by creation time and ID. `limit` defaults to 50 and accepts 1–100. The opaque
  cursor belongs to the workspace; invalid or repeated query parameters fail.
- `GET /api/v2/workspaces/:workspaceId/locations/:locationId`: the stored location
  and original evidence, returning 404 for an unknown/foreign location.

All supported responses, including errors, have `Cache-Control: private, no-store`.
There is no public artifact URL, filesystem path, raw database error or stack trace
in these responses. Body-supplied coordinates, creator, workspace and other extra
fields are rejected. Cross-origin POST requests are rejected like the P0 routes.

POST uses the shared P0 per-actor/workspace request limit (30 requests/minute).
Retries with the same normalized request and requestId return the stored location
with 201. Different content for that requestId returns 409 IDEMPOTENCY_CONFLICT.
Membership is checked again even on retries. The location, initial analysis link
and idempotency receipt are written in the same transaction. The shared advisory
lock query casts its void result to text for Prisma compatibility.

## Private evidence

Set `RESEARCH_ARTIFACT_ROOT` to the same absolute private durable directory used
by the P1 publisher, outside Next.js public/static directories. Storage must be
shared with the server reading it; local filesystem permissions and durability
limitations from `research-publication.md` still apply. No fixture fallback exists.
Stored GETs and successful retries do not require source artifacts to remain online.

The initial reader supports JSON observations artifacts containing a research-2
detections page or an array of pages. Each page's analysisId must equal the final
published P1 result ID, and periodRole must match its artifact metadata. A producer
adapter must bind this identity before publication; P0 placeholder IDs are rejected.

The reader verifies the private file's identity, byte size and SHA-256 before
returning bytes. The evidence layer independently checks size/checksum, schema,
source membership, inclusive UTC period and AOI containment. Identical repeated
observations are acceptable; conflicting snapshots with one detection ID fail.
Only observations artifacts supply anchors; cluster IDs and estimated grids do not.
Parquet/GeoJSON observations fail with DEPENDENCY_UNAVAILABLE until an authentic
decoder is supplied. There are guards of 128 artifacts and 64 MiB total evidence;
these are not benchmarked service limits. Missing anchors return NOT_FOUND;
missing, unsupported, corrupt or inconsistent evidence returns a safe dependency error.

## Immutable history

Creation snapshots the original observation, initial analysis, AOI revision and
creator from server data. Reading never recalculates the anchor from the latest
feed or period. `linkMonitoringLocationAnalysis` authorizes an accessible published
P1 result in the same workspace and inserts an idempotent append-only link. It
does not change the anchor, initial analysis, AOI or creator. Existing database
triggers and composite foreign keys enforce these history boundaries.

## Verification and remaining integration

Tests cover the evidence decoder, HTTP handlers, service transactions on PGlite,
and native PostgreSQL concurrent retries/conflicts, rollback, membership revocation
and immutable anchor/link history. The existing guarded native schema helper needs
`RESEARCH_TEST_DATABASE_URL` pointing at localhost database `research_worker_test`
and `PYTHON` pointing at an interpreter with psycopg. Missing native configuration
skips native tests and is not acceptance evidence.

Local verification passed 149 Node tests (including seven native PostgreSQL tests)
and 105 Python tests without skips, plus typecheck, npm lint, contract checks and
the Next production build. Independent code review found no blockers and reran
the 28 evidence/service/HTTP tests successfully. Dedicated HTTP coverage at the
shared rate-limit threshold and maximum-size/contended transaction benchmarks
remain additional coverage work; no production capacity is claimed.

P0-to-P1 submission/result bridging, full Nathan N4 provenance, OAuth/HTTP acceptance
against staging, operational artifact configuration and teammate review remain
separate integration work. This implementation does not declare those complete.
