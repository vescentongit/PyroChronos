import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { foundationFixture } from './helpers/research-foundation-fixtures.mjs';

const hook = registerHooks({ resolve(specifier, context, next) {
  return next(context.parentURL?.endsWith('/research-foundation-contracts.ts') && specifier.startsWith('./') && !specifier.endsWith('.ts')
    ? `${specifier}.ts` : specifier, context);
} });
let contracts;
try { contracts = await import('../src/lib/research-foundation-contracts.ts'); }
finally { hook.deregister(); }
function schema(name) {
  assert.ok(contracts[name], `${name} is not implemented`);
  return contracts[name];
}
const publication = () => {
  const { location, ...value } = foundationFixture();
  return value;
};

test('synthetic job input, attempt, result, manifest and artifacts satisfy the foundation contract', () => {
  const value = foundationFixture();
  for (const [name, input] of [
    ['analysisJobInputSchema', value.job.input], ['analysisJobRecordSchema', value.job],
    ['analysisJobAttemptSchema', value.attempt], ['analysisManifestSchema', value.manifest],
    ['analysisResultRecordSchema', value.result], ['analysisArtifactSchema', value.artifacts[0]],
    ['monitoringLocationRecordSchema', value.location],
  ]) schema(name).parse(input);
  schema('analysisPublicationSchema').parse(publication());
});

test('job input and stored job cannot disagree on actor-independent workspace, AOI or request context', () => {
  for (const mutate of [
    (v) => { v.workspaceId = 'other-workspace'; },
    (v) => { v.input.request.areaRevision++; },
    (v) => { v.requestId = '44444444-4444-4444-8444-444444444444'; },
    (v) => { v.input.baselinePolicy.minimumValidYears = 11; },
  ]) {
    const value = foundationFixture().job; mutate(value);
    assert.equal(schema('analysisJobRecordSchema').safeParse(value).success, false);
  }
});

test('attempt lease, failure fields and terminal timing obey the lifecycle', () => {
  for (const mutate of [
    (v) => { v.leaseExpiresAt = v.claimedAt; },
    (v) => { v.heartbeatAt = '2000-01-01T00:00:00Z'; },
    (v) => { v.completedAt = '2026-09-04T00:00:00Z'; },
    (v) => { v.status = 'running'; },
    (v) => { v.status = 'failed'; },
    (v) => { v.attemptNo = 0; },
  ]) {
    const value = foundationFixture().attempt; mutate(value);
    assert.equal(schema('analysisJobAttemptSchema').safeParse(value).success, false);
  }
  const failed = { ...foundationFixture().attempt, status: 'failed', errorCode: 'PRODUCER_FAILED', retryable: true };
  schema('analysisJobAttemptSchema').parse(failed);
});

test('publication rejects mixed workspaces, jobs, versions, geometry, sources and manifest references', () => {
  for (const mutate of [
    (v) => { v.attempt.workspaceId = 'other'; },
    (v) => { v.result.jobId = 'other'; v.result.payload.jobId = 'other'; },
    (v) => { v.manifest.dataVersion = 'other'; },
    (v) => { v.manifest.id = 'other'; },
    (v) => { v.manifest.geometryHash = `sha256:${'b'.repeat(64)}`; },
    (v) => { v.manifest.sourceSnapshots[0].checksum = `sha256:${'e'.repeat(64)}`; },
    (v) => { v.artifacts[0].resultId = 'other'; },
    (v) => { v.attempt.status = 'running'; v.attempt.completedAt = null; },
    (v) => { v.result.payload.baseline.policyVersion = 'other'; },
    (v) => { v.result.payload.primary.period.start = '2026-08-02'; v.result.payload.primary.days--; },
    (v) => { v.result.publishedAt = '2026-09-04T00:00:00Z'; v.result.payload.publishedAt = v.result.publishedAt; },
  ]) {
    const value = publication(); mutate(value);
    assert.equal(schema('analysisPublicationSchema').safeParse(value).success, false);
  }
});

test('a completed raw/unsupported publication is valid without claiming harmonized estimates', () => {
  const value = publication();
  const payload = value.result.payload;
  payload.mode = 'research'; payload.method.name = 'raw'; payload.method.validation = 'unsupported';
  for (const entry of [payload.primary, payload.comparison, ...payload.months].filter(Boolean)) {
    entry.metric.harmonizedCount = null; entry.metric.status = 'method_unsupported';
  }
  for (const entry of payload.months) entry.anomaly = {
    status: 'method_unsupported', referenceYears: [], baselineStatistic: null, baselineValue: null,
    delta: null, scoreKind: null, score: null,
  };
  schema('analysisPublicationSchema').parse(value);
  payload.primary.metric.harmonizedCount = 1;
  assert.equal(schema('analysisPublicationSchema').safeParse(value).success, false);
});

test('manifest rejects overlapping training/test, duplicate sources and unknown provenance fields', () => {
  for (const mutate of [
    (v) => { v.trainPeriod = { start: '2020-01-01', end: '2020-12-31' }; v.testPeriod = { start: '2020-12-31', end: '2021-12-31' }; },
    (v) => { v.sourceSnapshots.push(structuredClone(v.sourceSnapshots[0])); },
    (v) => { v.DATABASE_URL = 'private-sentinel'; },
  ]) {
    const value = foundationFixture().manifest; mutate(value);
    assert.equal(schema('analysisManifestSchema').safeParse(value).success, false);
  }
});

test('private artifacts reject URLs, traversal, malformed hashes and negative or unsafe sizes', () => {
  for (const patch of [
    { objectKey: 'https://private.invalid/key' }, { objectKey: '../escape.parquet' },
    { objectKey: '/absolute/file' }, { objectKey: 'private\\file' },
    { checksum: 'bad' }, { bytes: -1 }, { bytes: Number.MAX_SAFE_INTEGER + 1 },
  ]) assert.equal(schema('analysisArtifactSchema').safeParse({ ...foundationFixture().artifacts[0], ...patch }).success, false);
});

test('location records preserve the original observation identity and creator', () => {
  for (const patch of [{ anchorDetectionId: 'cluster-1' }, { createdById: 'other' }, { areaRevision: 0 }, { name: 'x'.repeat(201) }]) {
    assert.equal(schema('monitoringLocationRecordSchema').safeParse({ ...foundationFixture().location, ...patch }).success, false);
  }
  schema('monitoringLocationAnalysisSchema').parse({ locationId: 'location', workspaceId: 'workspace', analysisId: 'result', createdAt: '2026-09-02T00:00:00Z' });
});

test('persistence timestamps reject microseconds before database millisecond rounding', () => {
  const value = publication();
  value.result.generatedAt = '2026-09-02T00:00:01.123456Z';
  value.result.publishedAt = '2026-09-02T00:00:02.123456Z';
  value.result.payload.generatedAt = value.result.generatedAt;
  value.result.payload.publishedAt = value.result.publishedAt;
  assert.equal(schema('analysisPublicationSchema').safeParse(value).success, false);
  // Millisecond wrapper columns must not hide microseconds in the JSON payload.
  value.result.generatedAt = '2026-09-02T00:00:01.123Z';
  value.result.publishedAt = '2026-09-02T00:00:02.123Z';
  assert.equal(schema('analysisResultRecordSchema').safeParse(value.result).success, false);
  value.result.payload.generatedAt = value.result.generatedAt;
  value.result.payload.publishedAt = value.result.publishedAt;
  schema('analysisPublicationSchema').parse(value);
  const job = foundationFixture().job;
  job.createdAt = '2026-09-02T00:00:00.000001Z';
  assert.equal(schema('analysisJobRecordSchema').safeParse(job).success, false);
  const location = foundationFixture().location;
  location.createdAt = '2026-09-02T00:00:00.000001Z';
  assert.equal(schema('monitoringLocationRecordSchema').safeParse(location).success, false);
});
