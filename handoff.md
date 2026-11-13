# PyroChronos handoff

## Current objective

Complete and verify Bagas Sprint 1 (B1–B4), including the real Google sign-in → workspace → area → analysis job → results flow, security/workspace isolation, and cross-team review. The user prefers Google OAuth because researchers may not have GitHub accounts. Do not mark the sprint complete until its acceptance criteria and human review are actually met.

Start with `D:/NASA/AGENTS.md`, `D:/NASA/tasks/Bagas/SPRINT-1-P0.md`, `D:/NASA/docs/bagas-sprint-1-progress.md`, and `D:/NASA/docs/contracts/api-v2.md`; they contain the scope, contract, evidence, and known limitations. `D:/NASA/product.md` is the current product direction. The previous agent onboarded all repository Markdown files.

## State and evidence

- Latest commit at handoff: `d19dc1e` (Google OAuth and Bagas Sprint 1 foundation). The working tree contains uncommitted changes; inspect `git status` and diffs before editing. `AGENTS.md` and `google.png` are untracked user/workspace files: preserve them.
- OAuth is configured for Google. Neon connectivity and the three applied migrations were confirmed. The local `.env` contains secrets; never print, copy, or include them in logs or handoff. Research v2 was enabled locally. The active research dataset was registered while empty, so jobs against it return `no_data` until real processed data is added and re-registered. Do not assume the configured Neon database is non-production.
- A local server and a background worker were started earlier; check their current state rather than relying on old PIDs. The worker had stopped on a transient Prisma transaction-acquisition timeout; an uncommitted fix in `scripts/research-worker.mjs` adds retry and safe error handling. Avoid stopping unrelated user processes.
- First-run UI lacked workspace creation. Uncommitted changes add a Google sign-in link and workspace creation in `src/components/research-panel.tsx`, with client support and a test. The existing design and bilingual behavior should be maintained. User was asked asynchronously to create a test workspace using their Google session, but no confirmation was received.
- Real NASA MODIS standard archive 2000 was downloaded into ignored `.cache/research-acceptance/`, separate from the active dataset. For bbox `[-65,-15,-45,0]`, November 2000, producer and worker bundle produced 4,869 raw detections across five pages and 30 daily rows; status `partial`, VIIRS missing, harmonized estimate null. This validates a local producer/bundle, not worker publication to Neon or validated harmonization.
- 59 Node tests passed before the additional workspace test, targeted tests passed after it, typecheck passed, and `next build` passed. `npm run build` hit Windows `EPERM` replacing Prisma's engine because live server/worker processes held the DLL; do not misrepresent `next build` as the full command. Python targeted suite passed 29 tests with one conditional skip. See the progress document and `.cache/research-sprint-1/results.json` for details.
- Desktop and mobile Chrome acceptance passed using mocked v2 responses; the script was updated to accept either the unauthenticated or unavailable state and to test first-workspace creation. These tests do not validate a real Google session, HTTP workspace access against Neon, data publication, or reviewer approval.
- Cross-workspace tests and job lease/reclaim were performed using PGlite, but real PostgreSQL multi-session concurrency, complete HTTP authorization cases, genuine end-to-end worker publication and real-user review remain unverified. Assess shortcomings in code rather than inferring production readiness from passing mocks.

## Browser tooling and next steps

The user explicitly requested Playwright MCP. `playwright` was successfully registered globally using the installed Codex CLI with command `npx @playwright/mcp@latest`; `codex mcp get playwright` verified it enabled, and the package ran as version 0.0.85. A new/restarted Codex session may be required for its tools to appear. Discover available tools first. The previously listed browser-use skill had no Node REPL tool exposed in that session; the agent therefore ran the repo's Chrome headless QA with an isolated test profile. Do not claim that isolated Chrome QA used the user's Google session.

1. Check whether Playwright MCP is now available and whether a user-authenticated local browser tab is accessible; respect the user's account and do not request credentials. If necessary ask the user to authenticate or create a workspace while continuing independent work.
2. Complete genuine, non-destructive HTTP end-to-end and access tests on a confirmed isolated non-production database/dataset. Test idempotency, conflicts, pagination binding, membership changes and concurrency, worker recovery, and result provenance. Do not write synthetic test records into an unknown production database. Keep demo/raw/validated states distinct.
3. Investigate whether the real-data test dataset can be safely used in an isolated runtime; the active dataset is empty and its path may be outside the repo. Avoid changing the active dataset or deleting user data without establishing scope.
4. Update the sprint tracker with concrete results; reviewer sign-off by the named human is still needed. No PR or human approval was recorded.

## Suggested skills

- `ponytail` for coding, debugging, tests, and review.
- `browser-use:browser` for Codex in-app browser QA if its required runtime tools are available; otherwise use an available Playwright MCP appropriately. Do not bypass the skill's in-app-browser tool requirements.
- `impeccable` for any further frontend or onboarding changes.
- `openai-docs` for Codex/MCP configuration or troubleshooting.