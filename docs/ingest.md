# P0-S1-B2: safe FIRMS ingestion

The private Python job owns ingestion. Next.js `/api/firms` remains a read-only
two-day CSV download proxy: it imports no batch/database/storage writer and
does not turn the demo dashboard into live analysis. No migration is added or
changed by B2, including the accepted B1 raw-batch migration.

## Configuration and scope

`config/firms.json` is the shared strict allowlist for Python and TypeScript.
It includes MODIS and VIIRS S-NPP/NOAA-20/NOAA-21 NRT and standard-processing
source IDs. This is a transport catalog, not proof of each source's availability
over a requested historical period. Product collection versions remain unknown
(`null`) until the source catalog can establish them. CSV row versions are
preserved in raw bytes, never replaced by an invented collection version.

The two geometries deliberately preserve the existing prototype study rectangles
for `kalteng` and `papua`. Their version/source clearly state that they are not
final administrative polygons. Bbox values are derived from this registry,
never accepted from the browser/job request. Orkhan's final geometry/source/area
and Nathan's versioned source catalog still require team sign-off; update the
manifest/boundary versions when replacing this provisional configuration.
Downstream analysis must clip to the final polygon, not treat bbox coverage as
the study boundary or use raw row counts as an activity index.

Job environment:

- `FIRMS_MAP_KEY`: required, server/job environment only; no `NEXT_PUBLIC_` copy.
- `DATABASE_URL`: non-production PostgreSQL/Neon during verification.
- `FIRMS_RAW_DIR`: private filesystem root on a persistent job volume. Do not put
  it in `public/`, a web-served directory, git, or ephemeral Vercel storage.

The job does not load `.env` files. Supply secrets through the job runner's
environment, never CLI arguments. CLI stdout is the safe JSON result; stderr
contains only allowlisted metadata events. Do not enable external HTTP URL/body
tracing, `NODE_DEBUG=http/https`, or APM capture of credential-bearing paths.
Python HTTPX/httpcore emitters are suppressed because URLs can contain the key;
the Node proxy uses native HTTPS instead of Next's instrumented fetch cache.

## Transport, validation and persistence

The destination is fixed to HTTPS `firms.modaps.eosdis.nasa.gov`; all redirects,
including same-host redirects, are rejected. Requests have a **20 second total
network deadline**, including connection, headers and all body chunks. Response
size is capped at **5 MiB**, using both declared length and streamed bytes.
Only identity content encoding is accepted, avoiding decompression expansion.
Incomplete/mismatched-length bodies are rejected; without a length/checksum from
upstream, a syntactically complete prefix cannot prove all detections arrived.

After a successful transport, raw bytes are published before CSV validation and
before `FETCHED` metadata is recorded. HTML/zero-byte/malformed CSV is preserved
privately and marked `REJECTED`. Responses containing a literal or URL-encoded
key echo are rejected **before storage or browser output**. Non-200 responses,
oversized bodies and failed transfers do not create a purported complete raw
object. A valid header-only CSV becomes `EMPTY`; it never means "no fire".

The built-in `firms-envelope-v1` validator checks known/required header fields,
row widths, UTF-8/CSV structure, finite coordinates within the requested bbox,
date/time shape, finite nonnegative FRP and product-family confidence syntax.
It preserves raw rows and does not normalize, deduplicate, aggregate, infer
observation coverage, or certify scientific quality. Nathan's parser can be
injected with its own `validator_version`; its result is a nonnegative raw row
count. `VALID` means this versioned validation succeeded, not operational or
harmonization approval. Missing coverage remains unknown downstream.

`FileRawStorage.put()` uses a UUID-derived internal key, file fsync, atomic
create-without-replacement, and read-back byte/hash verification. Repeating a
put with identical bytes is safe; changing bytes under the same key is rejected.
It is a local-volume adapter, not an object-storage service. Private directory
ACLs and persistent-volume provisioning are deployment responsibilities. Directory
entries are not explicitly fsynced, so power-loss durability of a newly published
pathname is not guaranteed; crash recovery/reconciliation remains necessary.

`PostgresRawBatches` uses parameterized SQL against B1 and a psycopg asynchronous
connection with `dict_row` and **autocommit=True**. The unique claim commits before
network I/O; existing batches are never upserted or reset. SQL/driver exceptions
are mapped to safe machine codes without exposing messages, query parameters,
DSNs, stack traces or raw response bodies.

## Idempotency and failures

Supply a canonical UUID `request_id` for a logical attempt. Its first claim may
fetch; the same ID/scope thereafter only observes the stored state and does not
refetch or rewrite the file. Reusing it for a different region/source/window or
configuration returns `IDEMPOTENCY_CONFLICT`. New intentional downloads use new
UUIDs, so unchanged checksums and archive revisions both retain fetch history.

**`retryable=true` permits a new attempt with a new UUID.** It does not reset or
resume an old attempt. Same-ID `IN_PROGRESS` means persisted `PENDING/FETCHED`,
not proof that its worker is alive. An ambiguous database commit is never
reported as success. On metadata failure the job makes a best-effort `FAILED`
transition; sustained outages or worker interruption may leave a nonterminal
claim and/or an orphan raw object. Preserve these for reconciliation rather
than overwriting them. Automated reconciliation, retry/backoff and scheduling
remain Tahap 2 work.

Results expose only `batchId`, `status`, allowlisted `errorCode`, and `retryable`.
Operational log events contain only `batchId`, known `regionId`/`sourceId`,
`status`, duration in milliseconds and safe `errorCode`. Unknown incoming IDs
and arbitrary exception messages are never logged.

| Condition | Error code | Retry with new UUID |
|---|---|---|
| Missing environment | `CONFIG_MISSING` | After configuration |
| Invalid region/source/window/ID | `REGION_NOT_ALLOWED`, `SOURCE_NOT_ALLOWED`, `INVALID_REQUEST` | After correction |
| Total network deadline | `UPSTREAM_TIMEOUT` | Yes |
| Rate limit / upstream outage | `UPSTREAM_RATE_LIMITED`, `UPSTREAM_UNAVAILABLE` | According to `retryable` |
| Redirect / access denied | `UPSTREAM_REDIRECT`, `UPSTREAM_DENIED` | After investigation |
| Invalid CSV / response / excessive bytes | `INVALID_RESPONSE`, `PAYLOAD_TOO_LARGE` | According to `retryable` |
| Storage / database failure | `STORAGE_FAILED`, `DATABASE_FAILED` | Yes; reconcile old attempt |

## Running and verification

Requires Python 3.11+ (3.14.6 verified here), Node 24+ for native TypeScript tests,
and installed Node dependencies. Python's `py` launcher works in this workspace.

```sh
npm ci
py -m venv .cache/ingest-venv
.cache/ingest-venv/Scripts/python.exe -m pip install -r pipeline/requirements-dev.txt
.cache/ingest-venv/Scripts/python.exe -m unittest discover -s pipeline -v
.cache/ingest-venv/Scripts/ruff.exe check pipeline
npm test
npm run lint
npm run typecheck
npm run build
```

After provisioning the non-production environment and applying reviewed B1
migrations, invoke a private job (the command contains no credentials):

```sh
py pipeline/run_ingest.py --region kalteng --source VIIRS_NOAA20_NRT --start 2026-11-09 --days 1 --request-id c146ffdb-734b-47f1-a3c0-3bff7ec79af1
```

Use the virtualenv Python executable instead of `py` unless that environment is
activated. The CLI selects a selector event loop for psycopg on Windows.

Tests cover timeout over cumulative body delay, redirect rejection, payload
caps/truncation, source/region allowlists including prototype keys, malformed
CSV/HTML/empty, checksum/storage immutability, concurrent duplicate attempts,
structured failures and credential sentinels in results/logs/exception chains.
Python integration tests execute the **production repository SQL** against
PostgreSQL WASM via a test-only stdio bridge, with real files and shipped B1
migrations; no repository mock is used for those cases. They do not prove
native psycopg/Neon connectivity or multi-session behavior. Verify those against
a dedicated non-production deployment before release. No live FIRMS key or
Neon database was used for these tests.

Lint is scoped to B2 JS/TS files by `biome.json`; Ruff checks pipeline code.
Ruff's B905 exception for existing `harmonize.py` is explicit: its `mae()` already
rejects unequal lengths, and B2 does not modify scientific code.

TDD evidence: 15 initial Python boundary tests and 7 initial Node boundary tests
failed before implementation; 2 SQL integration tests failed before the adapter.
Subsequent RED tests pinned safe failure-code handling, parser-version provenance,
bbox/date validation and best-effort failure recording. Final review found no
blocking issue under the documented replay-only idempotency contract; directory
fsync and interrupted-attempt reconciliation are documented limitations.

Final local verification: **29 Python tests**, **25 Node tests**, and **9 production
server smoke checks** passed. Biome, Ruff, TypeScript checking, Prisma validation
and the Next.js production build passed. No commit or remote migration was made.
