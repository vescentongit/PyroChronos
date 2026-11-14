# Vercel deployment

Updated 2026-11-15 for on-demand historical analysis and local verification. This is implementation/configuration, not evidence of a hosted deployment. The public app remains usable without login or Google OAuth. [Current verification and remaining gates](verification-2026-11-15.md).

## Services and routing

`vercel.json` retains the public `app` (Next.js, repository root) and private `pipeline` (Python WSGI, `pipeline/app.py`). The sole public rewrite sends `/(.*)` to `app`. Its one service binding injects `PIPELINE_URL` into the calling app. Never set that variable manually or expose it in client code. Public URLs and routing have not changed.

`/api/local-research` validates origin, request schema, canonical geometry and producer output. It calls private `POST /produce` with action `analyze` and the actual area/date input. Python prepares a request-scoped immutable snapshot, computes its fingerprint from the actual response checksums and consumes that snapshot in the same invocation. A key, requested dates or current time cannot stand in for observation provenance. The internal service accepts no client paths or frozen queue-producer configuration. `GET /health` remains private.

## Server configuration

| Variable | Service | Purpose |
| --- | --- | --- |
| `FIRMS_MAP_KEY` | `pipeline` | On-demand historical Area API and data availability; secret, server-only |
| `FIRMS_MAP_KEY` | `app` | Separate recent-hotspots proxy; secret, server-only |
| `PIPELINE_URL` | `app` | Vercel-generated binding, never manually configured |
| `RESEARCH_DATA_DIR` | Local Python or `pipeline`, optional | Existing local detection store; selects local analysis instead of live requests |
| `RESEARCH_PYTHON` | Local Next.js only | Python interpreter; defaults to `python` |
| `FIRMS_BLOB_BASE_URL`, `BLOB_READ_WRITE_TOKEN` | `pipeline`, legacy optional | Private archive fallback only if neither local data nor an on-demand key is selected |

Configure the NASA key in both services using the project's private runtime settings. Never use `NEXT_PUBLIC_` for a key, echo `.env*`, or put keyed URLs in logs/CLI arguments. Local `next dev` loads `.env*` and passes server environment to its Python child. The private WSGI service reads its own runtime environment. No database, Google credentials, Blob/R2 bucket, archive backfill or scheduled publisher is required by this path. Prisma generation at build time does not apply migrations.

## Data and staged loading

The browser splits the primary/comparison periods into calendar months and sends one stage at a time through the public route. Python checks current FIRMS availability, fetches only bounded 1–5 day windows and non-antimeridian bbox pieces, filters the exact polygon and deduplicates original observations. Only MODIS_SP and VIIRS_SNPP_SP are used. NRT stays separate, and source gaps remain unavailable rather than being silently filled.

Reference history is fetched only for primary months with supported model domains. Every available reference window required by the chosen rolling policy is requested, including partial-month/leap-year boundaries. Comparison stages need their estimates but do not fetch unused anomaly references. Existing model validity is unchanged, including unsupported Kalteng/Papua estimates.

CSV responses require the expected header, valid rows and timestamps. A successful header-only response covers the requested days with zero observations. Missing source dates have null coverage. Network/rate/schema failures fail the stage and never become zero or an apparently missing reference year. Snapshot provenance retains source/date/bbox, response SHA-256, row/byte counts and availability checksum without a key-bearing URL. Primary/comparison original observations keep their coordinates, confidence and FRP; no synthetic detection positions are created.

Each successful stage is saved in IndexedDB before moving on. Browser metadata identifies reusable geometry/date/method-policy stages across retries and reloads. The UI distinguishes not loaded, loading, saved and failed; saved source coverage and counts are shown. The previous full analysis remains available while loading. Only after all stages succeed does the browser assemble the complete requested calendar and comparison, preserving all per-stage manifests/checksums and rewriting page identities to the combined result. Exports use this completed snapshot. Failed or cancelled requests retain completed stages; clearing browser data loses local results. Storage failure is an error, not a false success.

Saved snapshots are deliberately reused and do not automatically check upstream revisions. The explicit refresh checkbox refetches all stages. A cache contains analysis results and selected original evidence, not a global raw archive or cross-device synchronization.

## Bounds and failure handling

- Input: 100 KB. Hosted response: 4,000,000 bytes including the private response envelope. Producer timeout: 120 seconds; public route max duration: 300 seconds; browser timeout: 250 seconds per stage.
- On-demand stage: at most one calendar month per requested period. Fetch budget: 95 seconds, six parallel requests, 512 planned requests, 4 MB per raw response, 24 MB total raw bodies, 150,000 snapshot observations including references. Outstanding requests have a bounded 10-second timeout and are cancelled on failure where possible.
- Browser assembled result: 32 MB of stage bundles and 100,000 primary/comparison observations. Exceeding a bound fails explicitly without truncation; reduce area/period. Browser storage quota may fail earlier. There is no promise that decades of data will fit one result or load quickly.
- One analysis per process remains a local admission limit, not a distributed global rate limiter. FIRMS/provider quotas are shared by the configured key; rate-limit errors return 429. A public anonymous deployment can consume that key's quota. Revisit capacity limits using measurements before making service guarantees.

Local detection stores and the legacy private Blob adapter remain supported. `.github/workflows/firms-dataset.yml` has no scheduled trigger; its manual legacy publisher remains guarded by `FIRMS_DATASET_SYNC_ENABLED=true`. Do not activate it or create/delete cloud resources as part of on-demand setup. Existing empty stores are left alone.

## Verification and release

Run `npm test`, `npm run typecheck`, `npm run check:contracts`, `npm run build`, and Python unit tests with `pipeline/requirements-dev.txt` installed. `pipeline/test_firms_on_demand.py` exercises coverage, exact polygon filtering, deduplication, antimeridian planning, reference selection and fingerprints. `tests/research-on-demand.test.mjs` tests the browser client using storage doubles and the actual Next handler/Python HTTP service with synthetic NASA responses. The separate `scripts/research-on-demand-browser-check.mjs` exercises the rendered production app and real Chromium storage, including reload/resume, refresh, cancellation, storage failures, exports and mobile overflow. Neither establishes live NASA availability or hosted routing. Setup, evidence and limits are in the [15 November verification](verification-2026-11-15.md).

The earlier Linux session could build with Webpack but was blocked when the default Turbopack CSS worker bound a local port, including after permission changes. The subsequent Windows continuation verified production builds and expanded synthetic browser acceptance to 18 checkpoints, including cancellation during the final storage commit and saved-result selection while another analysis is running. See the verification report for the build and source scope of each run. This does not establish hosted readiness. The existing Vercel configuration passed the official JSON schema checked in the earlier session; remote configuration still requires verification. No linked project or Vercel authentication was found in that Linux session. The Windows continuation did not recheck cloud access or create replacement resources.

For local Vercel routing, use `vercel dev --local`; plain `next dev` instead uses the Python subprocess. An earlier Windows session hit symlink EPERM in Vercel's local builder; that is not an established Linux limitation. Keep unrelated dev processes running. `.vercelignore` excludes local datasets, credentials and cache artifacts.

Before deploying, review the existing project and service configuration; do not duplicate the project merely because a checkout lacks `.vercel/project.json`. Configure only required server secrets. Create an authorized Preview, verify `/`, `/simulation`, original recent hotspots and a small historical analysis, retry/resume, unavailable dates and browser exports. Confirm public `/health` and `/produce` do not expose Python handlers and the browser never sees a NASA key or binding URL. Promote only after hosted acceptance and deployment authorization. Do not apply legacy database migrations unless those features are explicitly being enabled.

Official API references: [FIRMS Area API](https://firms.modaps.eosdis.nasa.gov/api/area/) and [source availability](https://firms.modaps.eosdis.nasa.gov/api/data_availability/). Hosting references: [Vercel services](https://vercel.com/docs/services) and [bindings](https://vercel.com/docs/services/bindings).
