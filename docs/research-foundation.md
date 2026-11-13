# R2-P1 Step 1: data foundation

> Stage 7B: new submissions use `P1AnalysisJob` and publish `AnalysisResult`.
> P0 `AnalysisRun`/`AnalysisJob`/`AnalysisArtifact` data remain unchanged and
> readable through the API's legacy fallback. Old queued P0 jobs require an
> explicit operational drain; they are not silently rewritten into P1 jobs.
> The P1 migrations are separate from P0. A database that already applied
> the earlier P1 migration under the P0 migration name requires a separately
> reviewed reconciliation; do not apply these migrations blindly there.

The initial step added persistence and internal contracts for R2-P1-B1/B2.
Stage 7B connects the authenticated submission, P1 queue, Nathan producer,
atomic publisher, locations/inspections and private exports. Experimental
routes remain gated by RESEARCH_V2_EXPERIMENTAL=true; local synthetic native
acceptance does not establish staging OAuth, live archives or deployment.
The public `research-2` contracts in `research-contracts.ts` remain unchanged.

The [worker](research-worker.md) supplies fenced claims/leases; the
[publisher](research-publication.md) validates and commits immutable results.

## Active submission and versioning

`npm run research:worker -- --register` activates a new immutable producer
snapshot in ResearchDataset using RESEARCH_DATA_DIR and optional
RESEARCH_MODELS_DIR. It includes original archive checksums/fingerprint,
exact model/baseline JSON documents and their hashes, harmonization/quality
policy hash, producer source fingerprint and build commit. Re-run registration
to activate changed files; unregistered filesystem changes do not silently
change queued jobs or the active API configuration. Missing versions fail closed.

POST /api/v2/workspaces/:workspaceId/analyses validates the current session,
active membership, immutable AOI revision and optional monitoringLocationId.
The latter must belong to the same workspace, even if the caller belongs to
both workspaces. Workspace-locked idempotency returns the original receipt;
same requestId with different content returns 409. Input versions are resolved
from the active snapshot and frozen with the complete request. Scoped dataVersion
matches Nathan's actual source/year checksum calculation.

The compute key includes workspace/AOI/settings and the entire producer snapshot,
including model, baseline and policy content hashes. It excludes requestId and
monitoringLocationId so identical work can share a P1 job. Different registered
content invalidates reuse even when human version strings are unchanged. A
request against an already successful identical job can return 200; retries keep
their original 202/200 receipt. Job polling exposes current persisted status.

The additive P1AnalysisLocationRequest table retains every location interested
in shared work. Composite FKs constrain workspace/job/location scope, and triggers
prevent UPDATE/DELETE/TRUNCATE. The publisher locks workspace before job, then
adds MonitoringLocationAnalysis links in its publication transaction. A late
request for a cached successful result links immediately under the workspace lock.
Original anchor, evidence, initialAnalysisId and report history never change.

New P1 GET job/result/days/detections/raw-density tile routes authorize every read,
verify private artifacts and expose private/no-store responses with safe errors.
Old P0 job/result IDs retain read compatibility. Neither reading nor map movement
starts a producer. P1 raw-density tiles are derived from verified observations;
capacity/cache optimization remains separate from functional integration.

## P0 boundary

`workspaceId`, `requestedById`, `createdById`, `areaId` and `areaRevision` are
opaque P0 references. No fake User/Workspace/Area records are created. Synthetic
fixtures live only under `tests/` and derive from the explicitly synthetic v2
contract examples. Composite foreign keys prevent mixing P1 resources across
workspaces, but do not prove membership, AOI ownership or identity. The active
submission and read services supply those checks using the existing P0 identities.

## Models and invariants

- `P1AnalysisJob`: frozen input (including AOI snapshot and resolved data/model
  versions), workspace/actor/request-scoped idempotency, and public job state.
  New jobs are queued; running jobs can finish succeeded or failed. Terminal
  jobs cannot be reset. `analysisKey` is indexed, not globally unique: reuse of
  compute must remain subject to workspace permissions and retry policy.
- `P1AnalysisJobAttempt`: immutable claim identity/token, monotonic heartbeat and
  lease, and retained terminal history. The database serializes inserts by
  locking the parent job and permits only one running attempt at a time.
  Every replacement uses an attempt number greater than all previous attempts;
  gaps are allowed but lower unused numbers cannot bypass stale-owner checks.
  Worker transactions must consistently lock job before attempt. An expired
  attempt is closed before a replacement is inserted; the job remains running.
- `AnalysisManifest`: immutable provenance envelope, versioned source snapshots,
  batch/archive references and producer/build/pairing/missingness policy versions.
  Unknown product versions and ingest times remain nullable. Its `checksum`
  column records the canonical content hash; the future writer must calculate
  and verify it, rather than assuming the database verified its bytes.
- `AnalysisResult`: one immutable result per job, tied to a manifest of the same
  job/workspace and to the frozen input. Result rows are prepared while the job
  is running; readers must only expose results referenced by a succeeded job.
- `P1AnalysisArtifact`: private logical storage keys, checksum and safe byte count.
  New artifacts can only be attached before publication. No global raw archive
  is copied into these metadata tables. `BigInt` bytes map to a JSON-safe integer
  at the contract boundary (maximum `Number.MAX_SAFE_INTEGER`).
- `MonitoringLocation`: immutable original observation snapshot, creator,
  initial result and AOI revision, with workspace/creator/request idempotency.
  The original result must be published. The location service must
  resolve `anchorDetectionId` against the actual immutable observation dataset:
  schema validation alone cannot prove that a point is a real detection.
- `MonitoringLocationAnalysis`: immutable, workspace-consistent links to
  published results; follow-up analysis does not replace original location
  evidence. Links and initial location creation belong in one service transaction.

The SQL migration is additive and transactional. It does not alter either legacy
table or its data. Database checks guard lifecycle/envelope consistency; triggers
block deletes/truncation and history rewrites. Runtime roles must not own tables
or have DDL/trigger-disabling privileges. Retention/deletion policy is future work
and requires an explicit migration, not a runtime bypass.

## Internal contracts

`src/lib/research-foundation-contracts.ts` exports Zod schemas and inferred TS
types for frozen job input, job/attempt records, manifests, result envelopes,
artifact metadata, and location records/links.

`analysisPublicationSchema` validates a prepared publication package: the job is
still running and its attempt has completed successfully. It reuses the existing
Zod result schema, including its cross-field refinements, and checks the package's
workspace/job/manifest, AOI, periods, source checksums, pinned versions, baseline,
timestamps and artifact scope. The publication service must also
read/lock the actual database state and verify current ownership/lease; accepting
a package does not authorize its publisher or validate scientific claims.

Job success is separate from method validation. A raw/unsupported result is
allowed to complete with null harmonized estimates. Experimental estimates stay
replay/demo; research estimates require a validated method/domain. Method-domain
evidence is owned by the producer and must also be checked during integration.

The public schemas are kept separate from internal metadata, especially object
keys and lease tokens. Do not serialize persistence records directly to API
responses. Neither this module nor the fixtures implement an API fallback.

Internal persistence timestamps accept seconds or at most three fractional
digits, matching `timestamptz(3)`. Producer adapters must explicitly serialize
milliseconds (for example, Python `isoformat(timespec="milliseconds")`) before
freezing the package. Microseconds are rejected instead of silently rounded;
the public `research-2` ISO timestamp schemas are unchanged.

## Verification

Use an explicitly supplied localhost test `DATABASE_URL` for Prisma validation
and generation; these commands need valid syntax, not a live connection. No
remote migration is part of this step.

```powershell
$env:DATABASE_URL = 'postgresql://test:test@127.0.0.1:5432/research_foundation_test'
npx.cmd prisma validate
npx.cmd prisma generate
npm.cmd run typecheck
node --test tests/research-foundation-contracts.test.mjs tests/research-foundation-db.test.mjs
npm.cmd test
npm.cmd run check:contracts
```

The contract tests cover positive synthetic packages and invalid scope, lease,
version, source, missingness and evidence cases. Type assertions under
`tests/types/` check Prisma enum compatibility and inferred DTO types during
typecheck. Database tests apply the shipped migrations to isolated PGlite schemas,
seed both legacy tables before the new migration, and exercise real SQL checks,
foreign keys, transitions, history protection and rollback. They do not prove
native PostgreSQL multi-session locking, Neon permissions, storage durability,
or a deployed worker; those are later integration checks.
