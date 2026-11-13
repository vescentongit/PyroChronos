> **Keputusan aktif 13 November 2026:** seluruh fitur web tanpa login; Google OAuth bukan persyaratan. Penyimpanan pengguna lokal di browser. Ketentuan akun/kolaborasi server dan status implementasi di bawah merupakan konteks rencana/riwayat sebelumnya; untuk keputusan dan status terbaru ikuti [status aktif](current-status.md).

# P0-S1-B1: raw batch storage

`RawBatch` records one FIRMS fetch attempt. A repeat download gets a new ID and
payload object key, even when its SHA-256 matches an older attempt. Revisions and
NRT/standard products remain separate records. `InspectionReport` is unchanged.

Prisma owns the schema and migrations. Python writers must supply their own
unique batch ID: Prisma's `cuid()` default is client-side, not a SQL default.
Times use `timestamptz(3)`; requested windows are `[requestedStart, requestedEnd)`.
Unknown product versions, counts and timestamps remain null. The source manifest
and region configuration must be versioned; region checksum covers the frozen
configuration, including its polygon. The bbox alone is not the study polygon.

## Lifecycle and invariants

- Insert a `PENDING` attempt with request/source/region provenance.
- Persist bytes under a private, write-once object key; verify their SHA-256 and
  byte length before moving to `FETCHED` with the payload reference.
- Finalize as `VALID` (positive row count), `EMPTY` (zero rows), or `REJECTED`.
  These statuses require a validator version. `EMPTY` describes a validated
  response, not an absence of fire or complete observation coverage.
- `PENDING` or `FETCHED` can become `FAILED` with `errorCode` and `retryable`.
  A failed attempt may lack a payload, but never invents a checksum or row count.
- Request provenance cannot change. Once fetched, the payload metadata cannot
  change. All terminal rows reject updates. Deletes and truncation are blocked.
  A retry creates another attempt; it never resets a terminal row to pending.

Checks and triggers are maintained in migration SQL because Prisma schema syntax
does not express them. Keep future migrations from removing these protections.
The migration uses a transaction and creates only raw-batch objects. Runtime
database roles must not own these objects or have DDL/trigger-disabling rights;
these protections do not constrain the database owner or superuser.

No raw body, credential-bearing URL, signed URL, exception message or stack trace
belongs in metadata. `payloadRef` is an internal object key. `errorCode` is a
bounded machine code; `validationSummary` must contain sanitized structured data.
Database errors can include failing row details: the B2 writer must map errors to
safe codes instead of logging raw exceptions.

This migration validates checksum syntax and preserves it; it cannot verify bytes
held in external storage or prevent overwriting an object. The B2 writer/storage
adapter must enforce those two properties. No ingest service is included here.

## Verification

```sh
npm ci
npm test
npx prisma validate
npx prisma generate
npm run typecheck
npm run build
py -m unittest discover -s pipeline -v
```

Prisma validation requires a syntactically valid `DATABASE_URL`; an explicitly
supplied localhost test URL suffices for validation/generation without connecting.
Never substitute a production URL for a test database.

`npm test` executes the shipped SQL migrations on isolated in-memory PostgreSQL
schemas via the pinned, development-only PGlite package. It seeds an inspection
report before applying the new migration and verifies report preservation and
uniqueness afterward. It exercises SQL enum/check/trigger behavior rather than a
mock or SQLite substitute. PGlite is PostgreSQL compiled to WebAssembly; these
tests do not prove Neon connectivity, deployment permissions, concurrent-session
behavior, or the Prisma migration deployment lifecycle. Before staging rollout,
also run `prisma migrate deploy` on a dedicated non-production PostgreSQL/Neon
database and verify the runtime role permissions there.

TDD evidence: before adding the model/migration, 16 batch tests failed and the
existing-report preservation test passed. After implementation, the suite passed.
Final verification: 18 Node tests passed, including a Prisma-versus-migration
catalog comparison. Review identified a test masking issue; immutability tests
now attempt changes during otherwise valid transitions. Removing each dedicated
immutability guard temporarily made the targeted test fail; restoring the SQL
returned the full suite to green. Prisma validation, client generation,
TypeScript checking and production build passed.
The initial pipeline baseline also passed all three existing Python tests using
the `py` launcher. No environment file or production database was used.
