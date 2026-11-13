# R2-P1-B4 implementation plan

**Spec:** Approved Step 6 plan in the conversation; tasks/Bagas/SPRINT-2-P1.md B4 and docs/contracts/api-v2.md.

**Goal:** Publish a private CSV/manifest pair tied to immutable P1 analysis and a consistent inspection snapshot.

**Architecture:** Reuse Python CSV row formatting for CLI and a bounded streaming subprocess. Reuse P0 sessions/membership/idempotency and P1 verified storage/evidence validators. A separate PostgreSQL export queue claims leased attempts; publication verifies both objects before committing immutable metadata and ready status.

**Constraints:** No automatic commits, no production migration, no P0 submission bridging, no rewrite of scientific results or legacy tables, strict existing export-create DTO, no any in new TypeScript.

- [x] TDD Python pure row generation, formula bypass protection and explicit period filtering.
- [x] Add three Prisma models and an additive SQL migration with composite scope, lifecycle/immutability and supporting indexes; validate and generate.
- [x] Extract shared observation iteration and report projection with B2/B3 regression tests.
- [x] Add export/manifest contracts, strict protected provenance and consistent current inspection snapshots, plus create/status and idempotency/deduplication.
- [x] Add leased worker queue, bounded Python stream, private atomic CSV/manifest publication and verified downloads.
- [x] Add four routes, JSON Schema/synthetic example and documentation.
- [x] Run unit/service/API/native PostgreSQL and Python suites, typecheck/lint/contracts/build/diff checks. Obtain one independent final review, fix material findings with regression tests, report exact git commands without committing.

## Implementation decisions

- Inspection snapshots are captured under the existing workspace write lock. Their content hash excludes capture time, so unchanged inspection context can reuse a ready export; new revisions/statuses create a different key. Old requestId retries retain the original snapshot/response.
- Comparison aggregate exports contain the published comparison summary only; no unpublished monthly estimates are invented.
- Missing satellite data stays blank. Original detections are deduplicated by identity; inconsistent duplicates fail.
- Private download verifies CSV and manifest before headers; a later stream failure aborts the stream rather than adding JSON to CSV.
- Export attempt history and ResearchRequest receipts record processing/creation. InspectionAuditEvent remains restricted to inspection resources.
- Input/output/count limits are explicit safety guards, not benchmarked service capacity, and fail without truncating data.

## Verification evidence

- Final run: npm test, 208 passed, zero failed/skipped; Python unittest discovery, 136 passed with native PostgreSQL enabled.
- Prisma validate/generate, typecheck, lint, contract checks, production build and git diff --check passed. Ruff passed for the three changed Python files.
- Native tests used a disposable localhost PostgreSQL 16 container and synthetic data. No production migration or git commit was performed.
- One independent review identified private-path and quoted-CSV secret bypasses; regression tests reproduced both before fixes and passed afterward. Decoded CSV record counts and configured OAuth secrets have additional regressions.
- An earlier full run failed while Docker Desktop was stopped; after restarting the isolated database, both complete suites passed.
- Python runtime-version metadata is deferred; formatter identity currently fingerprints both Python source files.
