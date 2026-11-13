# R2-P1-B4: private CSV and protected manifest exports

Exports consume published P1 AnalysisResult/AnalysisManifest and verified observations
artifacts. They do not query the current detection store, refit a model, rewrite an
analysis/location/report, or bridge P0 submissions. Python research_export.py is the
single CSV formatter shared by the CLI and the private NDJSON worker bridge.

## Runtime and API

Apply the new additive export migration as a separate authorized deployment step.
The migration adds ResearchExport, ResearchExportAttempt, ResearchExportArtifact and
their enums/indexes/guards, without changing existing table data. Source/creator/
attempt/artifact composite references constrain the workspace; final artifacts and
input snapshots cannot be updated, deleted or truncated. A partial unique index
allows one reusable queued/running/ready export per workspace/key while retaining
failed history. The schema consistency test checks its exact SQL separately from
Prisma-managed indexes, since Prisma 6 cannot represent partial indexes.

Keep RESEARCH_V2_EXPERIMENTAL=true for isolated development/staging. Set DATABASE_URL
through private runtime configuration, RESEARCH_ARTIFACT_ROOT to the same absolute
private durable directory used by publication, and RESEARCH_PYTHON (or PYTHON) to an
interpreter with the pipeline dependencies. Storage must be shared by worker/server.
The filesystem/ACL/durability limitations in research-publication.md still apply.

Run `npm run research:export-worker` for the persistent loop, or append `-- --once`
for one claim. SIGINT/SIGTERM cancel active work. Queue failures emit only a bounded
code and retry; neither the child stderr nor driver errors/DSNs are logged. No worker
is started by an HTTP request. There is no synthetic fallback for missing data.

Paths have prefix `/api/v2/workspaces/:workspaceId`:

| Method/path | Result |
|---|---|
| POST /exports | 202 queued/processing, 200 if identical artifacts are ready |
| GET /exports/:exportId | research-2 export metadata |
| GET /exports/:exportId/download | private UTF-8 CSV stream |
| GET /exports/:exportId/manifest | protected research-export-manifest-1 JSON |

POST retains the existing strict four-field DTO: requestId, analysisId, periodRole
and kind. There are no client paths, URLs, replacement versions, bbox or extra query
filters. Comparison requires a published comparison period. Every operation checks
the session and current active membership; downloads check access again after file
verification. Responses are private/no-store. CSV names are server-generated, with
nosniff and attachment headers; no storage redirect or object key is returned.

## Consistent snapshots and reproducibility

Creation holds the existing workspace write lock, checks idempotency, and reads the
published source plus locations linked to that analysis, assignments and latest
report projections/corrections. Those inspection projections are shared with B3.
The snapshot is frozen in the export row. Its content hash excludes capture time;
an unchanged context can reuse a ready export. Revisions/status changes produce a
new key for a new requestId. Retrying an old requestId returns its original receipt
after checking current access, even if processing has since completed.

Deduplication also binds workspace, analysis/source checksums, period/kind, formatter
source fingerprint and sanitization version. A worker with a different formatter
fingerprint refuses the queued job. The manifest contains snapshotAt, original AOI,
selected summary/period, data/model/baseline/source provenance, scientific status,
inspection context, formatter policy and CSV checksum/size/rowCount. It never claims
that a frozen inspection snapshot is still the latest at download time.

Original reports and subsequent correction history remain distinct; notes never
become detection rows. Inspection snapshot schemas reject foreign workspaces,
duplicate resources, orphan assignments and inconsistent report references.

## CSV scientific integrity and security

The shared reader validates artifact size/hash, page/result/role identity, source,
UTC period and exact polygon containment. Duplicate original IDs with identical
evidence are deduplicated; inconsistent copies fail. Known published raw totals
must match the unique observations. An empty verified no_data artifact yields a
header-only CSV with null scientific counts in the manifest; a missing artifact is
not silently treated as zero. Only JSON research-2 detection pages are decoded;
unsupported formats fail closed until an authentic decoder exists.

Missing values become blank CSV cells, real zero stays zero, and negative/decimal
numbers stay numeric. Satellite remains blank when absent from immutable evidence.
Text cells with formula prefixes, including prefixes hidden by whitespace/control/
format characters, receive an apostrophe; CSV quoting preserves commas, quotes,
newlines and Unicode. Aggregate exports use only published estimates without integer
rounding. Primary exports include its summary/month rows; comparison exports include
the available published period summary and declare period-only granularity.

Manifest construction uses an explicit allowlist. Source/storage paths, payloadRef,
headers, runtime configuration and raw errors are excluded. Known configured secrets,
DSN credential fragments (encoded/decoded), and every related analysis/export lease
UUID (case-insensitive) are scanned. The worker scans before staging and again inside
publication; download revalidates the exact manifest/CSV pair and rescans with current
configuration/tokens. Unsafe values fail instead of silently rewriting provenance.
Filesystem/cloud-storage paths and internal object-key namespaces are rejected even
inside free-text provenance; configured private-root values are also scanned. CSV
checks decode quoted cells before secret scanning, including after configuration
changes, and count decoded records rather than physical newline characters.

## Lease, storage and publication

Claims use PostgreSQL FOR UPDATE SKIP LOCKED. Default lease is 60 seconds, heartbeat
15 seconds, process deadline 120 seconds, and at most three attempts. Expired leases
cannot heartbeat or finalize. Retry retains terminal attempt rows; a final failure
does not remove earlier ready exports. The attempt history and ResearchRequest
receipts provide processing/creation records; inspection audit events are unchanged.

CSV is streamed into a private temporary object, synced and published with a hard
link that cannot replace an existing key. Each attempt owns separate immutable keys.
Both CSV and manifest are verified before one transaction publishes artifact metadata,
successful attempt and ready status. Final verification occurs under the job lock;
lease checks guard the completion statements. A failed transaction may leave private
orphan files for reconciliation, but cannot expose partial metadata or delete old files.

Input is bounded to 128 observation artifacts, 256 MiB total and one million unique
observations; each private object and output is limited to 64 MiB. Inspection snapshots
are limited to 1,000 locations, 2,000 assignments and 2,000 reports. These are safety
guards, not benchmarked service capacity, and failures never truncate the dataset.
Final checksum/security validation and download retain a bounded verified CSV buffer
of up to 64 MiB before response headers, then emit 64 KiB chunks. A later stream
failure aborts rather than inserting an error JSON document into CSV.

## Verification

Unit/Python, service/API, manifest-security and guarded native PostgreSQL tests cover
formatting, missing versus zero, deduplication, access, retries, snapshot races,
lease expiry, publication rollback and immutable history. Native tests require a
localhost database named research_worker_test via RESEARCH_TEST_DATABASE_URL and a
PYTHON interpreter with psycopg. Missing native configuration skips those tests and
does not prove native acceptance. Contract checks also verify the new JSON Schema
and an explicitly SYNTHETIC manifest example. PNG remains the frontend's responsibility.

Producer/P0-to-P1 integration, staging OAuth/HTTP acceptance, production migrations,
storage deployment and capacity benchmarks remain separate authorized work.
The formatter fingerprint covers both Python source files; recording the Python
runtime version as additional reproducibility metadata remains a deferred improvement.
