# Vercel deployment

Prepared 2026-11-14. Service names, public routing, and bindings require the owner's confirmation before deployment. The website remains usable without Google OAuth or a user account.

## Services and routing

The root `vercel.json` declares `app` (Next.js, repository root) and `pipeline` (Python WSGI, `pipeline/app.py`). The only public rewrite sends `/(.*)` to `app`, including the existing `/api/hotspots`, `/api/firms`, and `/api/local-research` routes. No client URLs or path prefixes change.

The calling service `app` declares one binding to `pipeline`, injected as `PIPELINE_URL`. Only server functions read it, at request time. Do not put this variable in `.env`, the Vercel environment settings, middleware, or browser code. The private Python service exposes `POST /produce` and `GET /health` internally; neither has a public rewrite. Binding URLs grant network access, not application identity.

`/api/local-research` keeps its geometry/schema/origin checks and producer-result validation. It calls the private service to fingerprint the configured store and then produce a bundle. The service selects the store from its own environment; requests cannot supply a filesystem path or a frozen P1 producer configuration. Failures return generic codes without filesystem paths or credentials.

`npm run dev` retains the existing local Python subprocess when no binding is present. On Vercel a missing binding fails closed. The legacy database queue, ingest CLI, publication CLI, and export worker are separate operational programs, not long-running HTTP services; this configuration does not start them. Keep `RESEARCH_V2_EXPERIMENTAL` unset for the active browser-local product. Local UI exports continue to run in the browser.

## Environment and data

| Variable | Required by | Value / handling |
| --- | --- | --- |
| `FIRMS_MAP_KEY` | `app`, live FIRMS requests | NASA MAP_KEY, server-only; never use a `NEXT_PUBLIC_` prefix |
| `FIRMS_BLOB_BASE_URL` | `pipeline`, hosted historical analysis | Root URL of the private Vercel Blob store, without a path |
| `BLOB_READ_WRITE_TOKEN` | `pipeline` and GitHub publisher | Blob server credential; store as a secret, never expose to the browser |
| `RESEARCH_DATA_DIR` | Local historical analysis | Local detection store; relative paths resolve against `pipeline/` in the HTTP service |
| `PIPELINE_URL` | `app` | Injected by Vercel; never set manually |
| `RESEARCH_PYTHON` | Local `npm run dev` only | Optional path to local Python executable; not needed on Vercel |

Google OAuth credentials, a coordinator token, and a database are not required for the active anonymous UI. The build runs Prisma generation without applying migrations. Enabling legacy server features requires their existing authorization, database, and persistent-storage setup separately.

Historical observations continue to come from NASA FIRMS. The scheduled publisher `.github/workflows/firms-dataset.yml` uses `pipeline/sync_firms_dataset.py` to check upstream archive revisions, download changed archives, validate/deduplicate observations through the existing `firms_archive.py`, and store immutable monthly PCD objects plus checksummed tile indexes in private Vercel Blob. It publishes a checksummed catalog and replaces `firms-v1/latest.json` only after the new objects exist. A failed year leaves the previously published snapshot intact; completed years survive a later failure and are skipped on retry when upstream metadata is unchanged.

The Python service reads only the requested source/month tile byte ranges, including the prior years actually needed by the baseline. It checks response ranges, compressed tile checksums and decoded sizes; it caches within one analysis and bounds reads to 64 MB, 1,024 storage requests and a 100-second I/O budget. It does not download all historical files into each function. The initial fingerprint pins an immutable release; publication of a newer catalog between calls cannot mix dataset versions. Missing archives retain `no_data`; an expected object that is missing/corrupt fails the analysis instead of becoming zero.

Scope follows the current producer: `MODIS_SP` from 2000 and `VIIRS_SNPP_SP` from 2012, through the current UTC year where NASA has published the archive. The annual country ZIPs omit detections outside countries, including the open ocean; this is not complete worldwide ocean coverage. Live NRT requests continue through the existing public Next.js APIs. Standard-processing archives and NRT are not silently joined, and new sensors do not automatically become harmonized. No new harmonization validity is claimed by moving the data to storage.

Set `FIRMS_BLOB_BASE_URL` to select hosted storage; it takes precedence over `RESEARCH_DATA_DIR` in the HTTP service. Without hosted storage, local processing still uses `RESEARCH_DATA_DIR`. Blob credentials stay on servers. Models remain in committed `pipeline/models/`. Local paths and function temporary disks are not durable cloud storage; `.vercelignore` excludes local datasets, credentials, caches, browser profiles, and the PDF.

## Activate FIRMS storage and daily updates

1. Create a **private** Vercel Blob store and connect it to the intended project. Record its base URL, for example `https://<store-id>.private.blob.vercel-storage.com`. Configure `FIRMS_BLOB_BASE_URL` and server-only `BLOB_READ_WRITE_TOKEN` for the Python service's Preview/Production environments. Do not put either value in browser code.
2. In this GitHub repository, set Actions secret `BLOB_READ_WRITE_TOKEN`, Actions variable `FIRMS_BLOB_BASE_URL`, and variable `FIRMS_DATASET_SYNC_ENABLED=true`. Use the same dedicated dataset store. The workflow stays disabled until that explicit activation; no store was created and no global backfill was started remotely by editing these files.
3. Run **Update FIRMS research dataset** manually. To check the setup cheaply, first use `start_year=2019`, `end_year=2019`; both research sources are processed. Then run from 2000 with an empty end year to backfill all available years. Each source respects its actual first year. Check Actions logs for published/unchanged/unavailable years.
4. The schedule is daily at **19:23 UTC / 02:23 WIB**. GitHub executes schedules from its default branch, so the workflow must be merged there. Repository-level concurrency serializes scheduled and manually dispatched runs; use this as the sole publisher. Do not run independent CLI publishers concurrently against the same `latest.json` (Blob pointer writes are atomic, but this implementation does not provide compare-and-swap between independent writers).
5. Initial processing has a 330-minute job ceiling. If a run fails or times out, rerun it: the last completed year remains published. Old immutable releases are retained to keep pinned analyses valid; no automatic deletion or lifecycle policy is enabled. Review Blob storage/transfer usage and GitHub Actions usage during backfill.

Annual ZIP access does not require `FIRMS_MAP_KEY`. The key remains necessary for the live Area API. Running the publisher outside Actions requires `python -m pip install -r pipeline/requirements-sync.txt` and the same two Blob environment variables, followed by `python pipeline/sync_firms_dataset.py --start-year 2000`. The optional `--source` restricts it to one supported research source, `--end-year` limits backfill, and `--force` rebuilds even unchanged archives. Upstream metadata is rechecked daily for older revisions too; a temporarily unavailable archive never deletes an existing published year.

## Local verification

Use a current Vercel CLI that supports `services`:

```sh
npx vercel@latest dev --local
```

This starts both services and injects the binding; `next dev` alone does not. Configure the Blob environment or a local `RESEARCH_DATA_DIR` in the Python service if testing analysis. `GET /health` belongs to the private Python service, so the public domain's `/health` must not expose that handler.

Automated checks:

```sh
node --test tests/research-producer-binding.test.mjs tests/local-research-api.test.mjs
python -m unittest discover -s pipeline -p test_service.py -v
python -m unittest discover -s pipeline -p test_firms_blob.py -v
npm run typecheck
npm run build
```

The Python adapter accepts at most 100 KB of request JSON and 4,000,000 bytes of result JSON. The hosted app applies the same result bound after validation to remain below Vercel's buffered response limit; larger analyses return `CAPACITY_LIMIT`. Local subprocess results keep the previous 100 MB bound. The Python function gets 120 seconds per invocation; the Next.js analysis route gets 300 seconds for both calls and validation. One active analysis per process is a local guard, not a distributed quota. Production capacity, durable job recovery, and larger streamed/paged bundles remain Sprint 3 operational work.

Verification on 2026-11-14: production build, TypeScript, contracts, and Ruff for the new Python adapter/tests passed. Node suite: 256 cases, 228 passed and 28 native PostgreSQL integration cases skipped; the subsequently added real HTTP adapter test also passed in the focused six-test run. Python suite: 156 cases, 139 passed and 17 integration cases skipped. Repository lint completed with six existing warnings in `research-export.ts` and no errors. The HTTP check starts an actual Python WSGI server against an isolated empty store, invokes the Next.js route through its runtime URL variable, and verifies the validated `no_data` bundle. It does not claim real-data scientific acceptance.

Vercel CLI 65.16.0 detected both services with the intended runtimes. `vercel dev --local --listen 3006` could not finish booting on this Windows laptop: builder-cache dependency installation failed creating symlinks with `EPERM`, including after leaving the sandbox. Full platform routing/binding injection, Python 3.12 on Vercel, and a deployed Preview are therefore not verified. No Windows permissions/settings were changed and no cloud project was linked or deployed. Retry in an environment permitting the CLI's symlinks, or verify through a Preview after owner confirmation.

## Preview and production

After confirming names, routing, binding, and dataset strategy:

1. Import this Git repository in Vercel with repository root `.`. Let `vercel.json` control each service's framework/build settings.
2. Add `FIRMS_MAP_KEY` as a server secret for the intended Preview/Production environments. Activate the private dataset store/publisher above and verify at least one published year. Do not copy the complete laptop `.env` into Vercel.
3. Create a Preview deployment. Check `/`, `/simulation`, the public hotspot API, anonymous area creation, and a small analysis against the provisioned store. Verify the Python `/health` and `/produce` handlers cannot be reached through the public domain. Browser storage on the new domain is independent of localhost.
4. Inspect runtime logs for both services; check a small live FIRMS request. Hosting changes the outbound network route but does not guarantee FIRMS availability or validate a MAP_KEY in advance.
5. Promote only after these checks and the owner's deployment confirmation. Do not run database migrations unless intentionally enabling the legacy database features.

References: [Vercel Services](https://vercel.com/docs/services), [bindings](https://vercel.com/docs/services/bindings), [Python runtime](https://vercel.com/docs/functions/runtimes/python), and [function limits](https://vercel.com/docs/functions/limitations).
