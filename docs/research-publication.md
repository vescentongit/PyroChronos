> **Keputusan aktif 13 November 2026:** seluruh fitur web tanpa login; Google OAuth bukan persyaratan. Penyimpanan pengguna lokal di browser. Ketentuan akun/kolaborasi server dan status implementasi di bawah merupakan konteks rencana/riwayat sebelumnya; untuk keputusan dan status terbaru ikuti [status aktif](current-status.md).

# R2-P1 Step 3: producer validation and atomic publication

The checkout was audited after merge `0f3ce41`. Nathan's `f624709` adds the
original-detection store, polygon queries, per-source counts and P0 raw
`research-2` adapter. R2-P1-N4 remains open. No producer, public contract,
Prisma model, migration, worker, location or report implementation is changed
by this step.

## Integration boundary

`publishResearchResult(dependencies, input)` in `src/lib/research-publication.ts`
accepts a private worker claim, producer output, and bounded artifact buffers:

- `claim`: jobId, workspaceId, attemptId and leaseToken from the queue.
- `producer.result`: the existing Zod `research-2` result DTO.
- `producer.manifest`: the existing internal `research-manifest-1` envelope.
- `artifacts[]`: kind, periodRole, format, declared checksum/bytes and Uint8Array
  content. Callers cannot choose filesystem paths, object keys or result IDs.

The adapter validates both existing schemas. It binds runtime IDs and the AOI
snapshot to the persisted job, after checking the producer geometry/hash. Model,
data, quality, baseline, satellite and aggregation versions must match frozen
input. A changed archive/model needs a new job; the publisher does not rewrite
`analysisKey` or silently substitute current data. Generated/published timestamps
are assigned from database time for the normalized persistence package, rather
than trusting producer placeholder publication timestamps.

Nathan's P0 `analysis-manifest-1` is not the persistence envelope and is not
silently relabelled. A complete producer handoff must supply the internal
envelope with real build/policy/source provenance. The integration test invokes
Nathan's real raw adapter over synthetic archives, supplies an explicitly
synthetic envelope with its actual output versions, and verifies that raw counts,
unsupported status and missing months survive publication. It does not claim
R2-P1-N4 or scientific validation is complete. Synthetic output stays demo/replay;
the publisher never promotes a method or substitutes zero for unknown values.

This module is a server/worker library, not a public route. A deployment wrapper
must supply its own authenticated worker process and private runtime configuration.
Membership/resource authorization remains P0 work. The queue supervisor's
processor hook must call publication before returning; this step does not
automatically install a production producer or expose a publication endpoint.

## Storage and transaction ordering

1. Parse the input, clone producer data/artifact buffers and reject configured
   secrets, the current claim token, or credential-bearing URLs. JSON artifacts are also scanned after
   decoding, so JSON escaping cannot hide secret values.
2. Read the actual latest attempt and verify its token, scope and live lease.
   Validate the complete prepared package before storing anything.
3. Derive result/manifest IDs and artifact key namespaces from the job/workspace/
   attempt identity. Artifact keys also contain the byte checksum, kind and role.
4. Write private objects without replacement and read them back to verify SHA-256,
   byte count and availability. Storage failure cannot publish metadata.
5. In one database transaction, lock the job first, then reread the latest attempt
   under that lock. Check ownership again, validate with `analysisPublicationSchema`,
   and reverify every object before publication writes.
6. Insert the canonical manifest and its checksum, immutable AnalysisResult and
   artifact metadata. Complete the attempt with a database-clock lease guard,
   then publish job status `succeeded`, resultId and completedAt with another
   deadline guard. Any failure rolls back all database writes.

`prismaPublicationDatabase(client)` supplies the production Prisma transaction
adapter. Values are bound parameters; raw SQL statement text is fixed in the
repository. The transaction has a 5-second acquisition wait and 15-second runtime
limit. File verification is deliberately inside the final transaction as well as
before it; choose artifact partition sizes and lease policy accordingly.

Object storage and PostgreSQL have no shared transaction. A failed transaction
can leave verified orphan objects, retained under their immutable attempt keys
for reconciliation. It cannot expose a partial database result or delete an old
result. Never delete shared/committed objects as compensation for a failed commit.

An identical retry, including a lost response after commit, compares the stored
result/manifest/artifact metadata and returns the same result with `reused=true`.
Changed retry content fails with `PUBLICATION_CONFLICT`. A stale or expired claim
cannot finalize. All responses/log events use bounded codes; storage paths,
   tokens, DSNs, raw driver errors and producer bodies are not logged. Error codes
   are also bounded by a runtime allowlist, including errors from JavaScript
   dependencies. A logger
failure after commit does not turn success into failure.

## Filesystem adapter

`FileResearchArtifactStorage` is a private durable-volume adapter. Supply an
absolute root outside Next.js public/static directories and configure private
ACLs; mode bits alone do not establish Windows confidentiality. Keys are checked
for traversal, parent symlinks/junctions are rejected, and final reads check file
identity and hash. A temporary file is fsynced, then hard-linked atomically
without replacement. Existing identical objects are safe to reuse; changed bytes
under an existing key fail. The default per-object limit is 64 MiB and can be
configured explicitly; it is a memory/storage guard, not a global analytics SLA.

The limit is checked by the storage adapter, after the publisher has received
and cloned its buffers; it is not an aggregate publisher-memory bound. Callers
must bound artifact batches/partitions before invoking this buffered API.

The root must live on persistent storage. Directory entries are not explicitly
fsynced, so power-loss pathname durability is not guaranteed. A missing object
fails verification; do not claim storage-provider durability or production ACLs
from local tests. An object-storage deployment must implement the same put-once
and verify contract with private access.

## Verification

Set `PYTHON` to the venv interpreter so the existing Nathan cross-language test
uses the installed Python dependencies. Native tests also require a localhost
database named exactly `research_worker_test`; every test creates and drops a
random schema. No production database or migration is used.

```powershell
$env:PYTHON = (Resolve-Path '.cache/ingest-venv/Scripts/python.exe').Path
# Set RESEARCH_TEST_DATABASE_URL to the dedicated local test container.
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run check:contracts
npm.cmd test
& $env:PYTHON -m unittest discover -s pipeline -v
.cache/ingest-venv/Scripts/ruff.exe check tests/helpers/research-publication-postgres.py
```

Tests execute the shipped migrations and production repository SQL on PGlite,
including rollback after manifest/result writes, storage failures, immutable
objects, secret checks, idempotency and preservation of an older readable result.
Native tests execute the Prisma adapter on PostgreSQL with concurrent publishers
and expiry during the transaction. The existing Python native queue suite also
runs against the same dedicated database. Missing native configuration skips
those tests and is not evidence of native integration success.
