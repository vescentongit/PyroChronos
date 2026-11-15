> **Active decision, 13 November 2026:** every web feature works without login; Google OAuth is not required. User data is stored locally in the browser. Account, server collaboration and implementation notes below that mention otherwise are earlier plans or history; for the latest decisions and status see [current status](docs/current-status.md).

# PyroChronos

PyroChronos is a fire activity observatory built for the NASA Space Apps Challenge 2026 challenge "Harmonization of MODIS and VIIRS Hot Spots". It turns NASA FIRMS hotspots from two satellite generations into one consistent fire calendar.

MODIS (Terra/Aqua, 1 km, since 2000) and VIIRS (Suomi NPP and NOAA-20, 375 m) see fires differently: VIIRS reports roughly four times more detections for the same activity, so their raw counts cannot be compared directly. PyroChronos converts VIIRS counts to a MODIS-equivalent scale (`ratio_global` model, MODIS-equivalent = VIIRS x 0.2458), tested on held-out years 2021 to 2025: mean absolute error per cell-month fell from 130.6 to 12.5 (90% lower) on 473,017 test cell-months. The model is validated per region; where validation fails (for example Southeast Asia) the estimate stays null instead of being guessed. See [method and rejected domains](docs/data/harmonization.md).

Team NasaCOM: M Orkhan, Shaquille N K, Bagas A P. Detailed internal documents under `docs/` are written in Indonesian.

## Stack

Next.js + Tailwind with a Python producer. A Home page with an interactive geographic globe, and a Simulation page with a MapLibre map, free-form polygons, historical calendar, comparison, original evidence, export and local reports. Central Kalimantan (Kalteng) and South Papua are example areas, not query limits. Supports Indonesian/English and Plus Jakarta Sans. Prisma/Neon is kept for the legacy server API.

## Running

```sh
npm install
npm run dev
```

Open http://localhost:3000. `npm run build` checks the production build.

For historical analysis, provide Python and a server-only `FIRMS_MAP_KEY` through `.env` or the process environment. `RESEARCH_DATA_DIR` selects a local store as an alternative; `RESEARCH_PYTHON` selects a local interpreter. Without producer configuration, pages still open and analysis reports the dependency as unavailable. A database and Google OAuth are not required. See [configuration and service limits](docs/vercel-deployment.md).

## Home and Simulation

- `/`: wireframe/dotted globe. Hovering or the Hotspot demo button shows illustrative points. Drag or arrow buttons rotate, scroll or buttons zoom; rotation can be paused and respects reduced motion.
- `/simulation`: dashboard. The Simulation CTA and navigation on Home lead here.
- `/simulation?region=papua` or `region=kalteng`: opens the selected study subset.

The globe component lives in `src/components/ui/wireframe-dotted-globe.tsx` (alias `@/components/ui`), following the project's UI component structure under `src`. It uses geographic D3 (`d3-geo`) and native Canvas without extra shadcn primitives or providers. Tailwind 4 and TypeScript are already set up.

Natural Earth geometry is stored locally in `public/geo`; source and license are in that folder's README. Regenerate the points with `node scripts/build-globe-land.mjs`. Pages do not fetch geometry from GitHub at runtime. Simulation CSS is scoped so navigation does not affect Home.

Checks: `npm run check:frontend` (Node.js 22.18+/24), `npm run typecheck`, `npm run build`, and `TEST_URL=http://localhost:3000 npm run smoke` with the server running. Typecheck disables the incremental cache so new route types are not held back by an old TypeScript cache.

[15 November verification](docs/verification-2026-11-15.md) records the production build, regression tests for storage, cancellation, result switching and transport, and 18 historical browser QA checkpoints. Port issues in an earlier Linux build are kept as historical evidence. Live FIRMS and hosted routing are not yet verified.

## Data status and implementation limits

Frontend acceptance without a real backend: `npm run check:browser`, with the server and local Chrome debugging running. The script uses an incognito context and synthetic API responses; how to run it and the resulting evidence are in [docs/frontend-acceptance.md](docs/frontend-acceptance.md).

Workspace data defaults to analyses saved in the browser: the dashboard, sensor comparison and field reports read the same historical result. The active `/api/local-research` path uses the Python producer and the published model on supported domains. Demo mode can be selected explicitly and uses illustrative candidates, charts, percentiles and priorities. The old `/api/snapshots` API is not available and is not called by the saved-analysis path. Old snapshot contract: `docs/contracts/snapshot-v1.md`. The Simulation map uses Esri World Imagery tiles; coordinate and list fallbacks remain available when the basemap fails.

## Browser storage and analysis

Configuration for two Vercel services (public `app`, internal `pipeline` via binding) is in `vercel.json`. Historical analysis fetches FIRMS data for the chosen polygon and period without a permanent global archive. The browser loads and stores data month by month, resumes unfinished parts, then builds the full calendar with provenance for every snapshot. The global archive schedule is disabled. The [Vercel deployment guide](docs/vercel-deployment.md) explains the server-only key and service limits; deployment has not been done yet.

Active decision: every web feature can be used without login and without Google OAuth configuration. The year by month calendar, two-period summary and anomaly table read the same analysis result. The local analysis path loads the published model from `pipeline/models`; estimates stay null on domains that fail evaluation. See [status and remaining sprint work](docs/current-status.md).

Research results now provide monitoring locations from original points, local assignment and review, corrections with history, observation and aggregate CSV, JSON/manifest and a calendar PNG. Clicking the density map zooms the camera before selecting a point; an evidence table is also available. Observation CSV uses a `recordType` column; empty results contain a `metadata` row with provenance and empty observation columns. Local names are not verified account identities. [Sprint 2 evidence and limits](docs/orkhan-sprint-2-progress.md).

Using the UI does not require login. The local workspace, areas, analysis choices, results and reports are stored in that device's browser; data is not synced to other devices or users. Clearing site or browser data can delete it. Old results from accounts or the server database are not copied to the browser automatically and are not deleted from the server.

Historical analysis is processed in Python using `FIRMS_MAP_KEY`, or `RESEARCH_DATA_DIR` when a local dataset is chosen (`RESEARCH_PYTHON` is optional for a local interpreter). Raw API data stays in memory only for the duration of a request; results, original evidence and manifests are stored in IndexedDB. Standard and NRT sources stay separate. Failed or unloaded parts never become zero; a successful CSV response with no observations yields zero observations, which is not evidence that there was no fire. The refetch option checks data revisions, while the normal cache keeps old snapshots. Size, time and concurrency are limited; multi-decade calendars may need many requests. Cross-device sync is not available yet.

## Legacy API and integrations

Implementation reference across Nathan, Bagas and Orkhan: [API payload contract v1](docs/contracts/api-v1.md), with runtime schema, JSON Schema, examples for both regions, and `npm run check:contracts`. Endpoints described as targets in the contract are not automatically available in the current scaffold.

Legacy endpoints for accounts, server workspaces and coordinator reports remain in the repository for compatibility; the local UI does not use them. To run them, copy `.env.example` to `.env` and fill in `DATABASE_URL` and a random `COORDINATOR_TOKEN` of at least 32 characters. Do not use the NEXT_PUBLIC prefix for secrets.

```sh
npx prisma migrate dev --name init
npx prisma generate
```

The legacy `GET /api/reports` and `POST /api/reports` endpoints accept the coordinator cookie or `Authorization: Bearer <COORDINATOR_TOKEN>`. New reports in the UI are stored locally, separately for demo and operational modes.

With `FIRMS_MAP_KEY`, `/api/firms?region=kalteng` or `region=papua` serves two days of NOAA-20 NRT CSV for the study bounding box. This endpoint does not enable scores or dashboard data automatically and does not claim full province coverage. No key is sent to the browser.

The private ingest service, shared source and region configuration, raw batch adapter and security tests are described in the [B2 ingest guide](docs/ingest.md). The FIRMS route is download-only: public GET requests do not write database batches. The Python job needs a server environment, a migrated non-production database, and private persistent raw storage; scheduled ingest is not enabled.

`pipeline/harmonize.py` keeps the old EQM experiment. The active research path uses the `ratio_global` model from a retrospective evaluation on the real archive with a moving baseline; see [method and rejected domains](docs/data/harmonization.md). This does not change demo scores or guarantee global or operational validity. Local report revisions are available; individual authentication is not required in the active version. Test with the dependencies in `pipeline/requirements-dev.txt`: `python -m unittest discover -s pipeline -p 'test_*.py'`.

Deployment migration: `npx prisma migrate deploy`. Do not run migrations during a request. This scaffold does not connect to or migrate Neon automatically.
