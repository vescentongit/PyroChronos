import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { before, beforeEach, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// Execute the shipped PostgreSQL migrations, not a mock or a copy of the DDL.
let db;
let sequence = 0;
let reportBefore;
before(async () => { db = await PGlite.create(); });
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`CREATE SCHEMA test_${++sequence}; SET search_path TO test_${sequence}, public;`);
  const root = new URL('../prisma/migrations/', import.meta.url);
  const migrations = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  await db.exec(await readFile(new URL(`${migrations[0]}/migration.sql`, root), 'utf8'));
  await db.query(`INSERT INTO "InspectionReport"
    ("id", "requestId", "candidateId", "observedAt", "result", "notes")
    VALUES ('existing-report', 'existing-request', 'kt-1', '2026-11-08T00:00:00Z', 'Belum dapat dipastikan', 'Preserve me')`);
  reportBefore = (await db.query('SELECT * FROM "InspectionReport"')).rows;
  for (const migration of migrations.slice(1)) {
    await db.exec(await readFile(new URL(`${migration}/migration.sql`, root), 'utf8'));
  }
});

const payload = Buffer.from('latitude,longitude\n-2.56,113.91\n');
const checksum = createHash('sha256').update(payload).digest('hex');
const base = () => ({
  id: `batch-${sequence}`, sourceId: 'VIIRS_NOAA20_NRT', sourceManifestVersion: 'sources-v1',
  processingLevel: 'NRT', productVersion: null, regionId: 'kalteng', boundaryVersion: 'boundary-v1',
  regionConfigChecksum: 'a'.repeat(64), requestBbox: [113, -3.6, 115, -1.5],
  requestedStart: '2026-11-07T00:00:00Z', requestedEnd: '2026-11-09T00:00:00Z',
  fetchStartedAt: '2026-11-09T01:00:00Z',
});
async function insert(overrides = {}) {
  const values = { ...base(), ...overrides };
  const keys = Object.keys(values);
  return db.query(`INSERT INTO "RawBatch" (${keys.map((key) => `"${key}"`).join(', ')})
    VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
  Object.values(values).map((value) => Array.isArray(value) ? JSON.stringify(value) : value));
}
async function fetched(id = base().id, bytes = payload) {
  await db.query(`UPDATE "RawBatch" SET "status" = 'FETCHED', "fetchedAt" = '2026-11-09T01:00:01Z',
    "checksumSha256" = $2, "payloadRef" = $3, "payloadBytes" = $4, "httpStatus" = 200
    WHERE "id" = $1`, [id, createHash('sha256').update(bytes).digest('hex'), `raw/${id}.csv`, bytes.length]);
}
async function valid(id = base().id) {
  await fetched(id);
  await db.query(`UPDATE "RawBatch" SET "status" = 'VALID', "completedAt" = '2026-11-09T01:00:02Z',
    "validatorVersion" = 'parser-v1', "rowCount" = 1 WHERE "id" = $1`, [id]);
}
async function row(id = base().id) {
  return (await db.query('SELECT * FROM "RawBatch" WHERE "id" = $1', [id])).rows[0];
}
const rejects = (action, code) => assert.rejects(action, (error) => error.code === code);

test('migration adds a queryable raw batch model', async () => {
  assert.equal((await db.query("SELECT to_regclass('\"RawBatch\"') AS name")).rows[0].name, '"RawBatch"');
});
test('migration preserves existing reports and their unique request constraint', async () => {
  assert.deepEqual((await db.query('SELECT * FROM "InspectionReport"')).rows, reportBefore);
  await rejects(() => db.exec(`INSERT INTO "InspectionReport" SELECT 'other', "requestId", "candidateId",
    "observedAt", "result", "notes", "createdAt" FROM "InspectionReport"`), '23505');
});
test('new attempts default to PENDING with unknown result fields remaining null', async () => {
  await insert();
  const batch = await row();
  assert.equal(batch.status, 'PENDING');
  for (const key of ['productVersion', 'checksumSha256', 'payloadRef', 'fetchedAt', 'completedAt', 'rowCount']) {
    assert.equal(batch[key], null);
  }
});
test('identical and revised payloads append without overwriting historical batches', async () => {
  await insert(); await valid();
  const original = await row();
  await insert({ id: 'repeat' }); await valid('repeat');
  await insert({ id: 'revision', productVersion: 'revised-v2', processingLevel: 'STANDARD' });
  await fetched('revision', Buffer.from('latitude,longitude\n-2.57,113.92\n'));
  assert.deepEqual(await row(), original);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM "RawBatch"')).rows[0].n, 3);
  assert.equal((await row('repeat')).checksumSha256, checksum);
  assert.notEqual((await row('revision')).checksumSha256, checksum);
  assert.equal((await row('revision')).productVersion, 'revised-v2');
});
test('payload checksum survives persistence with byte count and version provenance', async () => {
  await insert(); await valid();
  const batch = await row();
  assert.equal(batch.checksumSha256, createHash('sha256').update(payload).digest('hex'));
  assert.equal(Number(batch.payloadBytes), payload.length);
  assert.equal(batch.sourceManifestVersion, 'sources-v1');
  assert.equal(batch.boundaryVersion, 'boundary-v1');
  assert.equal(batch.validatorVersion, 'parser-v1');
});
test('database rejects unknown status and processing level', async () => {
  await rejects(() => insert({ status: 'SUCCESS' }), '22P02');
  await rejects(() => insert({ processingLevel: 'guessed' }), '22P02');
});
test('malformed SHA-256 and incomplete payload references are rejected', async () => {
  await rejects(() => insert({ regionConfigChecksum: 'invalid' }), '23514');
  await rejects(() => insert({ checksumSha256: checksum }), '23514');
  await rejects(() => insert({ status: 'FETCHED', fetchedAt: '2026-11-09T01:00:01Z',
    checksumSha256: 'bad', payloadRef: 'raw/bad.csv', payloadBytes: 12 }), '23514');
});
test('complete valid batches require a payload, positive count and validator version', async () => {
  await rejects(() => insert({ status: 'VALID', completedAt: '2026-11-09T01:00:02Z' }), '23514');
  await insert(); await fetched();
  await rejects(() => db.exec(`UPDATE "RawBatch" SET "status" = 'VALID',
    "completedAt" = '2026-11-09T01:00:02Z', "rowCount" = 1`), '23514');
});
test('EMPTY is valid only for a preserved response with zero parsed rows', async () => {
  await insert(); await fetched();
  await db.exec(`UPDATE "RawBatch" SET "status" = 'EMPTY', "completedAt" = '2026-11-09T01:00:02Z',
    "validatorVersion" = 'parser-v1', "rowCount" = 0`);
  assert.equal((await row()).status, 'EMPTY');
});
test('failed attempts retain structured failure without fabricating a checksum or row count', async () => {
  await insert();
  await rejects(() => db.exec(`UPDATE "RawBatch" SET "status" = 'FAILED',
    "completedAt" = '2026-11-09T01:00:02Z'`), '23514');
  await db.exec(`UPDATE "RawBatch" SET "status" = 'FAILED', "errorCode" = 'UPSTREAM_TIMEOUT',
    "retryable" = true, "completedAt" = '2026-11-09T01:00:02Z'`);
  assert.equal((await row()).checksumSha256, null);
  assert.equal((await row()).rowCount, null);
});
test('rejected responses preserve payload and structured validation failure', async () => {
  await insert(); await fetched();
  await db.exec(`UPDATE "RawBatch" SET "status" = 'REJECTED', "validatorVersion" = 'parser-v1',
    "errorCode" = 'INVALID_RESPONSE', "retryable" = false, "completedAt" = '2026-11-09T01:00:02Z'`);
  assert.equal((await row()).checksumSha256, checksum);
});
test('terminal historical batches reject updates and deletes', async () => {
  await insert(); await valid();
  const original = await row();
  await rejects(() => db.exec(`UPDATE "RawBatch" SET "productVersion" = 'replacement'`), '23514');
  await rejects(() => db.exec('DELETE FROM "RawBatch"'), '23514');
  assert.deepEqual(await row(), original);
});
test('TRUNCATE cannot bypass batch history protection', async () => {
  await insert();
  await rejects(() => db.exec('TRUNCATE "RawBatch"'), '23514');
  assert.ok(await row());
});
test('request provenance and fetched payload cannot be rewritten before validation', async () => {
  await insert();
  const pending = await row();
  // Use allowed transitions so the lifecycle guard cannot mask a missing
  // provenance/payload immutability guard.
  await rejects(() => db.exec(`UPDATE "RawBatch" SET "regionId" = 'papua', "status" = 'FAILED',
    "completedAt" = '2026-11-09T01:00:02Z', "errorCode" = 'UPSTREAM_TIMEOUT', "retryable" = true`), '23514');
  assert.deepEqual(await row(), pending);
  await fetched();
  const downloaded = await row();
  await rejects(() => db.exec(`UPDATE "RawBatch" SET "checksumSha256" = '${'b'.repeat(64)}',
    "status" = 'VALID', "completedAt" = '2026-11-09T01:00:02Z',
    "rowCount" = 1, "validatorVersion" = 'parser-v1'`), '23514');
  assert.deepEqual(await row(), downloaded);
});
test('status cannot jump over payload acquisition or regress to pending', async () => {
  await insert();
  await rejects(() => db.query(`UPDATE "RawBatch" SET "status" = 'VALID',
    "fetchedAt" = '2026-11-09T01:00:01Z', "completedAt" = '2026-11-09T01:00:02Z',
    "checksumSha256" = $1, "payloadRef" = 'raw/jump.csv', "payloadBytes" = 12,
    "rowCount" = 1, "validatorVersion" = 'parser-v1'`, [checksum]), '23514');
  await fetched();
  await rejects(() => db.exec(`UPDATE "RawBatch" SET "status" = 'PENDING'`), '23514');
});
test('invalid windows, timestamps, bounding boxes and negative counts are rejected', async () => {
  for (const overrides of [
    { requestedEnd: '2026-11-07T00:00:00Z' },
    { requestBbox: [115, -3.6, 113, -1.5] },
    { requestBbox: [113, -91, 115, -1.5] },
    { rowCount: -1 },
    { status: 'FAILED', errorCode: 'TIMEOUT', retryable: true, completedAt: '2026-11-09T00:59:00Z' },
  ]) await rejects(() => insert(overrides), '23514');
});
test('fetch timestamps preserve their UTC instant across offsets', async () => {
  await insert({ fetchStartedAt: '2026-11-09T08:00:00+07:00' });
  assert.equal((await row()).fetchStartedAt.toISOString(), '2026-11-09T01:00:00.000Z');
});
