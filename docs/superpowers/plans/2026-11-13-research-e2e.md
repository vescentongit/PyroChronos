# Research P1 end-to-end integration plan

> Use superpowers:executing-plans inline with TDD and one final independent review. No automatic staging, commits or production migrations.

**Goal:** New authenticated submissions use the P1 leased queue, authentic Nathan producer, atomic publication, persistent follow-up workflow and protected exports.

**Architecture:** Preserve P0 functions/data and read fallback. Register an immutable, path-free dataset descriptor including source archive checksums and exact model/baseline/policy snapshots. Submission resolves scoped producer versions from that descriptor; a Python supervisor runs the real producer in a cancellable subprocess and invokes the TypeScript publisher through a bounded private subprocess protocol. Location linking commits with publication. Active API reads support P1 with P0 fallback.

**Spec:** User's Stage 7B request and tasks/Bagas/SPRINT-2-P1.md, docs/contracts/api-v2.md.

**Constraints:** Strict new TypeScript without any; preserve raw/unsupported/null and authentic provenance; private authorization/error/cache policy; no automatic commit, no destructive legacy migration or synthetic production fallback. Existing branch and inline workflow continue as authorized.

## Tasks

- [ ] 1. RED→GREEN frozen producer configuration and manifest conversion: add pipeline/research_p1_producer.py and src/lib/research-producer-contracts.ts; extend optional P1 input/provenance metadata; update research_worker.py to honor frozen model/baseline, daily estimates and source versions. Test raw/unsupported, supported estimates, metadata hashes, missing data and changed configuration.
- [ ] 2. RED→GREEN submission/read bridge: add research-analysis-submissions.ts and research-analyses.ts; route new submitAnalysis through P1, keep submitLegacyAnalysis and legacy reads. Validate active workspace/area/location; deduplicate by frozen versions, authorize retries and link reused results. Include follow-up location linking inside publisher transaction. Test version invalidation, same/different workspace links and rollback.
- [ ] 3. RED→GREEN runtime bridge: add scripts/research-p1-publish.mjs and pipeline/research_p1_runtime.py; attach CLI to research_p1_worker.py and switch scripts/research-worker.mjs to P1 queue runtime with versioned --register. Bound private subprocess IO, cancel children on lease loss/shutdown, keep heartbeat outside producer/publisher work, log only safe statuses.
- [ ] 4. RED→GREEN native E2E: authentic Nathan synthetic archives and explicit model/policy fixtures, actual submission→worker→publisher→locations→assignment/report→CSV/manifest, with/without monitoringLocationId. Test raw/null, supported estimates, version changes, concurrency/retries, foreign-location rejection, preservation of P0 data and old results.
- [ ] 5. Update foundation/publication/runtime docs and integration limits; run npm test with isolated native PostgreSQL, Python suites, typecheck/lint/contracts/build/diff checks. Final independent review; fix material findings with RED→GREEN, report exact git commands without committing.

## Review focus

- Configuration changes between enqueue and processing must use the frozen version or fail, never substitute current files.
- Model/baseline/policy content changes must invalidate reuse even when human version strings are unchanged; activate new snapshots through --register.
- Reused successful jobs and late publication must link the authorized location without rewriting its anchor; cross-workspace links fail.
- Private subprocess errors/oversized output/cancellation must not leak credentials or bypass lease fencing.
- P1 read paths must preserve old P0 result readability, validate published artifacts and never expose uncommitted results.
