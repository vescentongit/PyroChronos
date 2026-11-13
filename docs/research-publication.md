# R2-P1 Step 3: producer validation and atomic publication

Stage 7B connects Nathan's research-2 producer (including available harmonization
and reference policy), the P1 leased supervisor and this publisher. New API
submissions enter P1; existing P0 data and legacy reads are retained. Native
end-to-end tests use explicitly synthetic archives/model snapshots, not a hidden
production fallback or proof of scientific validity on new domains.

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

Observation evidence is mandatory for each published primary/comparison period,
including an empty research-2 page for a no_data period. Arbitrary JSON, missing
pages, foreign analysis IDs, unsupported observation formats, invalid source/time/
polygon references and conflicting duplicate detections fail before storage.
The publisher uses the same verified observation iterator as locations and exports;
unique per-period/per-source totals must match the published raw metrics. Unknown
counts remain null and require no observations, rather than being rewritten as zero.

The producer page ID may be its own result ID or the final publication ID. After
verifying the supplied checksum/size, publication binds every observation page to
the final result ID, canonicalizes its JSON and recomputes checksum/size/object keys
before staging. Both single pages and arrays of pages are supported. Caller buffers
remain unchanged; an identical replay produces identical final metadata even after
the original lease expires. The shared reader's 128-artifact/64-MiB evidence limits
also apply at publication, so a successful publication is readable by B2/B4.

`pipeline/research_p1_producer.py` explicitly converts Nathan's
analysis-manifest-1 into research-manifest-1. It retains the native manifest hash,
actual source versions/checksums, archive-year checksums, model/baseline/policy
content hashes and harmonization metadata, with real producer/build provenance.
Model train/test months become explicit inclusive dates. Model/baseline JSON is
frozen at registration and forwarded to build_result; daily estimates use the
same published additive model. Unsupported domains and missing coverage retain
raw/null behavior. The adapter never promotes method validation. Explicit demo
registration remains demo throughout publication and export.

This module remains a private worker library with no public publication endpoint.
The runtime supervisor is pipeline/research_p1_worker.py, launched by
`npm run research:worker` (or `-- --once`). Its processor runs Nathan's producer
in a bounded cancellable subprocess, then invokes scripts/research-p1-publish.mjs
over private stdin. The Node bridge validates the bundle, rebinds daily pages,
constructs private artifacts and calls this publisher; the supervisor confirms
the committed result through PostgreSQL before reporting success. The producer
and publisher use separate processes/connections so heartbeats are not blocked.

Supply private DATABASE_URL, RESEARCH_DATA_DIR and RESEARCH_ARTIFACT_ROOT to both
worker/server, and RESEARCH_PYTHON/PYTHON where necessary. Registration also accepts
RESEARCH_MODELS_DIR and RESEARCH_PRODUCER_MODE (research/replay/demo). Apply the
additive migrations separately. A queued job requires its matching frozen archive
fingerprint; changed archives fail instead of substituting current data. Model
file changes do not replace frozen JSON. Re-register to activate new snapshots.
The private protocol is bounded to 100 MiB, producer observations to 100,000 and
publication evidence to the reader limits below; failure never truncates data.
These engineering guards are not measured capacity promises.

P1AnalysisLocationRequest tracks follow-up requests for shared work. Under the
workspace-before-job lock order, publication commits every pending location link
with the result. Failure rolls back links, manifests, artifacts and success
together; no anchor or initial evidence is rewritten. Cached successful results
can be linked by the authorized submission service without rerunning the producer.

## Storage and transaction ordering

1. Parse the input, clone producer data/artifact buffers and reject configured
   secrets, the current claim token, or credential-bearing URLs. JSON artifacts are also scanned after
   decoding, so JSON escaping cannot hide secret values.
   B1, B3 and B4 share the configured secret list, including OAuth/provider secrets,
   named token/API/private-key/password variables, private-root variants and DSN
   credentials. Percent-encoded and decoded forms are scanned as well as UUID
   casing variants. No service keeps a separate, narrower environment allowlist.
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
