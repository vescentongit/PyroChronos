# R2-P1-B2 implementation plan

**Goal:** Persist workspace locations with immutable evidence from published P1 results.

**Spec:** `tasks/Bagas/SPRINT-2-P1.md`, R2-P1-B2 and the approved Step 4 request.

**Architecture:** Reuse P0 auth, membership, workspace locks, idempotency, cursors and error DTOs. A P1 service reads only published AnalysisResult records and checksum-verified observations artifacts, creates MonitoringLocation and its initial MonitoringLocationAnalysis atomically, and appends later analysis links. Explicit workspace routes delegate to injectable HTTP handlers.

**Constraints:** No P0 submission bridging, schema changes, synthetic production fallback, automatic commits, or new dependencies. Work continues on the existing Bagas feature branch. POST accepts only the existing strict location-create DTO. All supported responses are private/no-store. All new TypeScript avoids any.

## Tasks

- [x] Add failing service/reader tests covering authentic anchor snapshots, strict POST input, idempotency/conflict, authorization, missing/corrupt evidence, pagination and append-only analysis links.
- [x] Extend private storage with checksum-verified reads and implement `src/lib/monitoring-locations.ts` plus the bounded observation reader.
- [x] Add failing HTTP handler tests, implement injectable handlers and explicit collection/detail routes using the existing auth and database helpers.
- [x] Add native PostgreSQL tests for concurrent retries/conflicts, rollback and immutable evidence/links, using the existing guarded schema helper.
- [x] Run all Node tests with native PostgreSQL enabled, Python tests, typecheck, npm lint, contract checks, and a Next build for route integration. Request one independent final review, address material findings with regression tests, and report exact git commands without committing.

## Decisions and review focus

- JSON artifacts contain one research-2 detections page or an array of pages, bound to the published result ID and artifact periodRole. Original observations must match the result's source, AOI and inclusive period. Unsupported Parquet/GeoJSON evidence fails closed until a real decoder is configured.
- Evidence lookup is bounded to 128 observation artifacts and 64 MiB total. These are implementation guards, not capacity/SLA claims.
- Initial anchor/creator/AOI snapshots remain immutable; reads use stored snapshots even if source files later disappear. Retry returns the stored idempotent response without rereading upstream artifacts.
- Pagination orders by createdAt then id with a workspace-bound cursor; default 50, maximum 100. Later analysis links require an accessible published P1 result in the same workspace and do not alter the initial AOI or anchor.
- Keep the existing experimental API gate. Runtime artifact storage is explicitly configured with RESEARCH_ARTIFACT_ROOT; missing configuration returns a safe dependency error for create, while stored location reads remain available.
- Native regression exposed Prisma's inability to deserialize the P0 idempotency lock's void column. Cast that one SELECT result to text in the shared helper; retain its locking semantics and all P0 submission behavior.

## Verification result

- Node: 149/149, no skips, with PostgreSQL native enabled (five location native tests and two existing publication native tests).
- Python: 105/105, no skips; typecheck, npm lint, contract checks, Next production build and git diff checks passed.
- Independent final review found no blockers and independently reran all 28 evidence/service/HTTP tests successfully.
- Deferred coverage: a dedicated HTTP rate-limit exhaustion/retry test. Large evidence parsing, workspace contention, actual producer binding, deployed HTTP/OAuth and operational private storage require separate integration/capacity verification.
- No schema/migration changes, automatic commits or P0 submission bridging.
