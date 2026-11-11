import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { before, beforeEach, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { digest, foundationFixture } from './helpers/research-foundation-fixtures.mjs';

let db, sequence = 0, legacy;
before(async () => { db = await PGlite.create(); });
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`CREATE SCHEMA foundation_${++sequence}; SET search_path TO foundation_${sequence}, public;`);
  const root = new URL('../prisma/migrations/', import.meta.url);
  const dirs = (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  for (const name of dirs.slice(0, 2)) await db.exec(await readFile(new URL(`${name}/migration.sql`, root), 'utf8'));
  await db.exec(`INSERT INTO "InspectionReport" ("id", "requestId", "candidateId", "observedAt", "result", "notes")
    VALUES ('legacy-report', 'legacy-request', 'legacy-candidate', '2026-01-01', 'Belum dapat dipastikan', 'Synthetic retained report');
    INSERT INTO "RawBatch" ("id", "sourceId", "sourceManifestVersion", "processingLevel", "regionId", "boundaryVersion",
      "regionConfigChecksum", "requestBbox", "requestedStart", "requestedEnd")
    VALUES ('legacy-batch', 'MODIS_NRT', 'synthetic-source', 'NRT', 'kalteng', 'synthetic-boundary',
      '${'a'.repeat(64)}', '[113,-3.6,115,-1.5]', '2026-01-01', '2026-01-02');`);
  legacy = await Promise.all(['RawBatch', 'InspectionReport'].map((table) => rows(table)));
  for (const name of dirs.slice(2)) await db.exec(await readFile(new URL(`${name}/migration.sql`, root), 'utf8'));
});
const rows = async (table) => (await db.query(`SELECT * FROM "${table}" ORDER BY "id"`)).rows;
async function insert(table, value) {
  const keys = Object.keys(value);
  return db.query(`INSERT INTO "${table}" (${keys.map((key) => `"${key}"`).join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
    Object.values(value).map((v) => v !== null && typeof v === 'object' ? JSON.stringify(v) : v));
}
function queuedJob(overrides = {}) {
  const { schemaVersion, ...value } = foundationFixture().job;
  return { ...value, status: 'queued', stage: null, progressPercent: null, startedAt: null, ...overrides };
}
async function start() {
  const f = foundationFixture();
  await insert('AnalysisJob', queuedJob());
  await db.query(`UPDATE "AnalysisJob" SET "status"='running', "startedAt"=$1 WHERE "id"=$2`, [f.job.startedAt, f.job.id]);
  await insert('AnalysisJobAttempt', { ...f.attempt, status: 'running', completedAt: null });
  return f;
}
async function prepared() {
  const f = await start();
  await db.query(`UPDATE "AnalysisJobAttempt" SET "status"='succeeded', "completedAt"=$1 WHERE "id"=$2`, [f.attempt.completedAt, f.attempt.id]);
  await insert('AnalysisManifest', {
    id: f.manifest.id, workspaceId: f.job.workspaceId, jobId: f.job.id,
    dataVersion: f.result.dataVersion, checksum: digest, content: f.manifest,
  });
  await insert('AnalysisResult', f.result);
  await insert('AnalysisArtifact', f.artifacts[0]);
  return f;
}
async function published() {
  const f = await prepared();
  await db.query(`UPDATE "AnalysisJob" SET "status"='succeeded', "resultId"=$1, "completedAt"=$2 WHERE "id"=$3`,
    [f.result.id, f.result.publishedAt, f.job.id]);
  return f;
}
function locationRow(f = foundationFixture()) {
  const { schemaVersion, ...value } = f.location;
  return value;
}
const rejects = (action, code = '23514') => assert.rejects(action, (error) => error.code === code);

test('migration creates all seven P1 entities and preserves legacy rows and uniqueness', async () => {
  for (const name of ['AnalysisJob', 'AnalysisJobAttempt', 'AnalysisResult', 'AnalysisManifest', 'AnalysisArtifact', 'MonitoringLocation', 'MonitoringLocationAnalysis']) {
    const result = await db.query('SELECT to_regclass($1) AS name', [`"${name}"`]);
    assert.ok(result.rows[0].name, `${name} is missing`);
  }
  assert.deepEqual(await Promise.all(['RawBatch', 'InspectionReport'].map((table) => rows(table))), legacy);
  await rejects(() => db.exec(`INSERT INTO "InspectionReport" SELECT 'duplicate', "requestId", "candidateId", "observedAt", "result", "notes", "createdAt" FROM "InspectionReport"`), '23505');
  await rejects(() => db.exec(`DELETE FROM "RawBatch"`));
});

test('job idempotency is scoped to workspace and actor while input remains frozen', async () => {
  await insert('AnalysisJob', queuedJob());
  await rejects(() => insert('AnalysisJob', queuedJob({ id: 'duplicate' })), '23505');
  await insert('AnalysisJob', queuedJob({ id: 'other-actor', requestedById: 'other-actor' }));
  await rejects(() => db.exec(`UPDATE "AnalysisJob" SET "analysisKey"='sha256:${'b'.repeat(64)}'`));
  const input = structuredClone(foundationFixture().job.input); input.area.workspaceId = 'other';
  await rejects(() => insert('AnalysisJob', queuedJob({ id: 'wrong-scope', requestedById: 'new', input })));
});

test('jobs cannot be inserted terminal, skip running, or claim success without a result', async () => {
  await rejects(() => insert('AnalysisJob', { ...queuedJob(), status: 'failed', error: {}, completedAt: '2026-09-02' }));
  await insert('AnalysisJob', queuedJob());
  await rejects(() => db.exec(`UPDATE "AnalysisJob" SET "status"='succeeded', "completedAt"='2026-09-02'`));
  await rejects(() => db.exec(`UPDATE "AnalysisJob" SET "status"='failed', "completedAt"='2026-09-02'`));
});

test('attempts require a running parent, unique sequence/token and a valid lease', async () => {
  const f = foundationFixture();
  await insert('AnalysisJob', queuedJob());
  await rejects(() => insert('AnalysisJobAttempt', { ...f.attempt, status: 'running', completedAt: null }));
  await db.exec(`UPDATE "AnalysisJob" SET "status"='running', "startedAt"='2026-09-02'`);
  await rejects(() => insert('AnalysisJobAttempt', { ...f.attempt, status: 'running', completedAt: null, leaseExpiresAt: f.attempt.claimedAt }));
  await insert('AnalysisJobAttempt', { ...f.attempt, status: 'running', completedAt: null });
  await rejects(() => insert('AnalysisJobAttempt', { ...f.attempt, id: 'concurrent', attemptNo: 2, leaseToken: '44444444-4444-4444-8444-444444444444', status: 'running', completedAt: null }));
  await rejects(() => db.exec(`UPDATE "AnalysisJobAttempt" SET "status"='succeeded', "completedAt"='2026-09-04'`));
});

test('expired attempts retain history and allow a new attempt without resetting the job', async () => {
  const f = await start();
  await db.exec(`UPDATE "AnalysisJobAttempt" SET "status"='expired', "completedAt"='2026-09-03', "errorCode"='LEASE_EXPIRED', "retryable"=true`);
  await rejects(() => db.exec(`UPDATE "AnalysisJobAttempt" SET "status"='running', "completedAt"=null, "errorCode"=null, "retryable"=null`));
  await insert('AnalysisJobAttempt', { ...f.attempt, id: 'next', attemptNo: 2, leaseToken: '44444444-4444-4444-8444-444444444444', status: 'running', completedAt: null });
  assert.equal((await rows('AnalysisJobAttempt')).length, 2);
  assert.equal((await rows('AnalysisJob'))[0].status, 'running');
});

test('replacement attempt numbers increase even when a lower unused number is available', async () => {
  const f = await start();
  await db.query(`UPDATE "AnalysisJobAttempt" SET "status"='succeeded', "completedAt"=$1`, [f.attempt.completedAt]);
  await insert('AnalysisJobAttempt', { ...f.attempt, id: 'higher', attemptNo: 3,
    leaseToken: '44444444-4444-4444-8444-444444444444', status: 'running', completedAt: null });
  await db.query(`UPDATE "AnalysisJobAttempt" SET "status"='succeeded', "completedAt"=$1 WHERE "id"='higher'`, [f.attempt.completedAt]);
  await rejects(() => insert('AnalysisJobAttempt', { ...f.attempt, id: 'late-lower', attemptNo: 2,
    leaseToken: '55555555-5555-4555-8555-555555555555', status: 'running', completedAt: null }));
});

test('manifest/result foreign keys reject mixed jobs and workspaces', async () => {
  const f = await prepared();
  await rejects(() => insert('AnalysisArtifact', { ...f.artifacts[0], id: 'cross', objectKey: 'other/data', workspaceId: 'other' }), '23503');
  await rejects(() => insert('AnalysisResult', { ...f.result, id: 'cross', workspaceId: 'other',
    payload: { ...f.result.payload, id: 'cross', workspaceId: 'other' } }), '23503');
});

test('result envelope, dataVersion and payload identity must match frozen provenance', async () => {
  const f = await start();
  await insert('AnalysisManifest', { id: f.manifest.id, workspaceId: f.job.workspaceId, jobId: f.job.id, dataVersion: f.result.dataVersion, checksum: digest, content: f.manifest });
  for (const patch of [{ dataVersion: 'other' },
    { dataVersion: 'other', payload: { ...f.result.payload, dataVersion: 'other' } },
    { payload: { ...f.result.payload, id: 'other' } }])
    await rejects(() => insert('AnalysisResult', { ...f.result, ...patch }));
});

test('publication transaction rolls back the entire new result on failure', async () => {
  await db.exec('BEGIN');
  try {
    await prepared();
    await rejects(() => db.exec(`UPDATE "AnalysisJob" SET "status"='succeeded', "resultId"='missing', "completedAt"='2026-09-02'`));
  } finally { await db.exec('ROLLBACK'); }
  for (const table of ['AnalysisJob', 'AnalysisResult', 'AnalysisManifest', 'AnalysisArtifact']) assert.equal((await rows(table)).length, 0);
});

test('successful publication is immutable and cannot receive late artifacts', async () => {
  const f = await published();
  for (const table of ['AnalysisJob', 'AnalysisJobAttempt', 'AnalysisManifest', 'AnalysisResult', 'AnalysisArtifact']) {
    await rejects(() => db.exec(`DELETE FROM "${table}"`));
    await rejects(() => db.exec(`TRUNCATE "${table}" CASCADE`));
  }
  await rejects(() => db.exec(`UPDATE "AnalysisResult" SET "dataVersion"='replacement'`));
  await rejects(() => db.exec(`UPDATE "AnalysisJob" SET "status"='running', "resultId"=null, "completedAt"=null`));
  await rejects(() => insert('AnalysisArtifact', { ...f.artifacts[0], id: 'late', objectKey: 'late/file' }));
});

test('an older completed attempt cannot publish after a newer attempt has claimed the job', async () => {
  const f = await prepared();
  await insert('AnalysisJobAttempt', { ...f.attempt, id: 'new-owner', attemptNo: 2,
    leaseToken: '44444444-4444-4444-8444-444444444444', status: 'running', completedAt: null });
  await rejects(() => db.query(`UPDATE "AnalysisJob" SET "status"='succeeded', "resultId"=$1, "completedAt"=$2`,
    [f.result.id, f.result.publishedAt]));
});

test('private artifact constraints reject public URLs, traversal and invalid sizes/checksums', async () => {
  const f = await prepared();
  for (const patch of [{ objectKey: '../escape' }, { objectKey: 'https://private.invalid/key' }, { bytes: -1 }, { checksum: 'bad' }])
    await rejects(() => insert('AnalysisArtifact', { ...f.artifacts[0], id: 'bad', objectKey: 'bad/file', ...patch }));
});

test('locations retain original evidence and retry cannot duplicate a location', async () => {
  const f = await published();
  await insert('MonitoringLocation', locationRow(f));
  await rejects(() => insert('MonitoringLocation', { ...locationRow(f), id: 'retry' }), '23505');
  for (const sql of [
    `UPDATE "MonitoringLocation" SET "anchorDetectionId"='cluster'`,
    `UPDATE "MonitoringLocation" SET "anchor"=jsonb_set("anchor", '{coordinates}', '[0,0]')`,
    `UPDATE "MonitoringLocation" SET "initialAnalysisId"='other'`,
    `DELETE FROM "MonitoringLocation"`, `TRUNCATE "MonitoringLocation" CASCADE`,
  ]) await rejects(() => db.exec(sql));
  assert.deepEqual((await rows('MonitoringLocation'))[0].anchor, f.location.anchor);
});

test('location creation rejects unpublished results, false anchor identity and mismatched AOI', async () => {
  const f = await prepared();
  await rejects(() => insert('MonitoringLocation', locationRow(f)));
  await db.query(`UPDATE "AnalysisJob" SET "status"='succeeded', "resultId"=$1, "completedAt"=$2`, [f.result.id, f.result.publishedAt]);
  await rejects(() => insert('MonitoringLocation', { ...locationRow(f), anchorDetectionId: 'cluster' }));
  await rejects(() => insert('MonitoringLocation', { ...locationRow(f), areaRevision: 2 }));
});

test('location-analysis links cannot cross workspace, duplicate or rewrite historical links', async () => {
  const f = await published();
  await insert('MonitoringLocation', locationRow(f));
  const link = { locationId: f.location.id, workspaceId: f.job.workspaceId, analysisId: f.result.id, createdAt: f.location.createdAt };
  await rejects(() => insert('MonitoringLocationAnalysis', { ...link, workspaceId: 'other' }), '23503');
  await insert('MonitoringLocationAnalysis', link);
  await rejects(() => insert('MonitoringLocationAnalysis', link), '23505');
  await rejects(() => db.exec(`UPDATE "MonitoringLocationAnalysis" SET "analysisId"='other'`));
  await rejects(() => db.exec(`DELETE FROM "MonitoringLocationAnalysis"`));
});
