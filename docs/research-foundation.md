> **Keputusan aktif 13 November 2026:** seluruh fitur web tanpa login; Google OAuth bukan persyaratan. Penyimpanan pengguna lokal di browser. Ketentuan akun/kolaborasi server dan status implementasi di bawah merupakan konteks rencana/riwayat sebelumnya; untuk keputusan dan status terbaru ikuti [status aktif](current-status.md).

# R2-P1 Step 1: data foundation

> Merge compatibility: the existing P0 `AnalysisJob` and `AnalysisArtifact`
> remain authoritative for the application. P1's corresponding tables and
> Prisma models are named `P1AnalysisJob` and `P1AnalysisArtifact`; the P1
> migration is separate from the already-applied P0 migration. This preserves
> both implementations but does not connect P1's worker or publisher to P0
> jobs. Integration and review remain open. A database that already applied
> the earlier P1 migration under the P0 migration name requires a separately
> reviewed reconciliation; do not apply these migrations blindly there.

This step adds persistence and internal contracts for R2-P1-B1/B2. It does not
implement a worker, publication service, routes, or production authorization.
The public `research-2` contracts in `research-contracts.ts` remain unchanged.

The subsequent [Step 2 worker](research-worker.md) adds queue/lease handling and
native PostgreSQL integration tests. Publication, producer and authorization
integration remain separate steps.

## P0 boundary

`workspaceId`, `requestedById`, `createdById`, `areaId` and `areaRevision` are
opaque P0 references. No fake User/Workspace/Area records are created. Synthetic
fixtures live only under `tests/` and derive from the explicitly synthetic v2
contract examples. Composite foreign keys prevent mixing P1 resources across
workspaces, but do not prove membership, AOI ownership or identity. P0 integration
must supply those checks and any additional foreign keys once its models exist.

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
  The original result must be published. The future location service must
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
timestamps and artifact scope. The future publication service still needs to
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
