# PyroChronos Task Tracker

Rencana eksekusi 3 sprint per anggota, pembagian pemilik, spesifikasi task, dan checklist PR ada di [`SPRINT-PLAN.md`](SPRINT-PLAN.md).

Living checklist for the agreed product scope in [`product.md`](../product.md). Status is based on the repository implementation as of 9 November 2026. “Done” means present in the prototype, not independently validated in operational use.

## Current state

- [x] Next.js, TypeScript, Tailwind, Prisma, and initial Neon schema/migration are in place.
- [x] Dashboard prototype supports Indonesia and English, preset Central Kalimantan/South Papua regions, candidate map/list, 24-hour and 7-day views, illustrative historical chart, and CSV export.
- [x] Demo inspection reports persist in browser local storage; coordinator-code session and Neon report API are scaffolded.
- [x] FIRMS API proxy can return a regional NOAA-20 NRT CSV when a server-side key is configured.
- [x] Experimental Python EQM helper and focused tests exist.
- [ ] Dashboard still uses illustrative candidates, chart values, anomaly percentiles, and priority labels. It is not live FIRMS analysis.
- [ ] Neon credentials, production coordinator identity, and deployment environment have not been configured or verified.

## P0 — Deliver a truthful working MVP

### Data and ingestion

- [ ] Configure a private FIRMS key on the server; verify API access for both preset study regions.
- [ ] Fetch the agreed MODIS and VIIRS FIRMS feeds, including the required satellite products and archive period; document exact source names, versions, timestamps, and refresh semantics.
- [ ] Store immutable raw batches with fetch time, source, version, and checksums so later archive revisions can be traced.
- [ ] Validate CSV schema, coordinates, timestamps, confidence, FRP, duplicate records, empty responses, late records, API failures, and rate-limit responses.
- [ ] Replace fixture candidates on the dashboard with processed FIRMS detections. Keep the data freshness timestamp and source status visible per feed.
- [ ] Remove hard-coded demo values from operational views; retain a clearly labelled demo/replay mode.

### Harmonization and current-activity analysis

- [ ] Decide and document the stable analysis unit and location clustering rule for point detections.
- [ ] Define comparable MODIS/VIIRS activity metrics without treating raw hotspot counts as equivalent observations.
- [ ] Select the satellite reference/combination rule for overlapping periods; do not inflate activity merely because more satellites are available.
- [ ] Build seasonal historical baselines for each preset region from archive FIRMS data; record the reference years, periods, missing-data treatment, and archive revision.
- [ ] Implement current-period versus same-season baseline comparison with partial-window handling.
- [ ] Fit and evaluate calibration per region using training and held-out time periods. Compare raw, simple baseline, and EQM; publish calibrated values only where validation supports them.
- [ ] Compute anomaly, recency, and persistence components with transparent explanations and nullable values when evidence is insufficient.
- [ ] Define the priority ordering and thresholds with coordinators; replay past periods without future-data leakage before describing rankings as validated.
- [ ] Distinguish observation time, ingest time, and publish time. Mark stale, partial, unavailable, and replay data explicitly.
- [ ] Keep “no FIRMS detection” distinct from “no fire”; do not infer cloud-free observation coverage from the hotspot point catalogue.

### User workflow and field reports

- [ ] Confirm preset study polygons/administrative areas for Central Kalimantan and South Papua; store stable IDs, geometry, area, source, and boundary version.
- [ ] Confirm 24-hour primary candidate window and 7-day persistence context; show older detections for recheck without implying extinguished/visited.
- [ ] Configure Neon and apply Prisma migrations in a non-production environment, then production.
- [ ] Replace shared coordinator token with individual Auth.js identity and server-enforced coordinator write permissions.
- [ ] Connect report form to Neon API; persist field inspection time separately from report entry time.
- [ ] Add stable candidate references, report history, duplicate request protection, correction audit trail, and refreshed-detection-after-inspection handling.
- [ ] Finalize inspection outcomes with coordinators; keep “not found during inspection” distinct from “extinguished”.
- [ ] Add validation for report fields, authorization, origin/CSRF protections, and safe error handling.

### Dashboard and release

- [ ] Orkhan: implement global heatmap browsing with viewport/zoom loading and sensor/time filters, independently of fixed analysis-region selection.
- [ ] Bagas: serve bounded global viewport data/tiles with caching, volume limits, safe FIRMS access, cancellation handling, and antimeridian support.
- [ ] Nathan: supply normalized global detection/aggregation semantics with provenance; keep unvalidated cross-sensor counts separate and expose regional analysis availability explicitly.

- [ ] Complete English and Indonesian coverage for navigation, map details, empty/loading/error states, reports, export headers, and date/time formatting.
- [ ] Verify responsive map fallback, keyboard access, focus handling, and readable status labels.
- [ ] Add scheduled ingestion with retry/backoff, atomic publication of completed analysis runs, and visible last-success/failure status.
- [ ] Keep analytics usable from the last valid snapshot if ingestion, Neon, map tiles, or network services fail.
- [ ] Deploy the Next.js app, configure environment secrets, and verify migrations and health checks against the deployed environment.
- [ ] Run end-to-end replay for live/stale/partial data, both regions, report persistence, and failed-service cases before presenting as operational.

## P1 — Validate scientific and operational value

- [ ] Build a time-based held-out benchmark for each study region and report sample counts, coverage limits, MAE/bias, and baseline comparisons.
- [ ] Compare Near Real-Time FIRMS records to later standard-science archive versions and quantify changes in anomaly/priority outputs.
- [ ] Validate candidate clustering and persistence rules against independent detections or documented field reports.
- [ ] Conduct coordinator review of whether the ranked candidates help choose patrol/verification locations; tune the factors and thresholds from documented feedback.
- [ ] Add a clear methodology panel with metric definitions, model version, baseline window, source versions, and reasons a score is unavailable.
- [ ] Assess transferability between the two regions without training on the evaluation period.

## P2 — Optional research and expansion

- [ ] Add raster FireMask/QA only if observation-coverage analysis is needed; verify product-specific QA definitions and spatial/temporal alignment.
- [ ] Evaluate TROPOMI CO, SMAP moisture, wind, peat, or land-cover context as supplemental evidence with suitable scale and quality controls.
- [ ] Consider any PyTorch/Hugging Face model only after specifying a labelled task, defensible baseline, evaluation data, and measurable benefit.
- [ ] Expand preset regions and historical periods after the two-region MVP pipeline and performance are stable.
- [ ] Consider geometry drawing, field-team accounts/mobile forms, offline sync, attachments, routes, or notifications only after user research supports them.

## Acceptance checklist

- [ ] Current detections and their observation/ingest/publish times are real and traceable to FIRMS inputs.
- [ ] The current period is compared with a like-for-like seasonal historical baseline; incomplete or insufficient data yields “cannot assess”.
- [ ] Harmonized output is labelled by method and is published only after held-out evaluation.
- [ ] Candidate priority explains anomaly, recency, and persistence; it does not claim fire confirmation, danger probability, or extinguishment.
- [ ] A coordinator can save, review, and correct a field report without losing its inspection time or history.
- [ ] English and Indonesian screens communicate the same status and evidence.
- [ ] Failure of a feed or backend cannot silently turn missing information into zero activity or a false “all clear”.
