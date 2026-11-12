import { readFileSync } from 'node:fs';

// SYNTHETIC ONLY: these IDs, hashes and observations are not operational evidence.
const examples = JSON.parse(readFileSync(new URL('../../docs/contracts/api-v2.examples.json', import.meta.url))).examples;
export const digest = `sha256:${'a'.repeat(64)}`;
export const requestId = '22222222-2222-4222-8222-222222222222';
export function foundationFixture() {
  const payload = structuredClone(examples.result);
  const input = {
    area: structuredClone(payload.area),
    request: { ...structuredClone(examples['analysis-create']), monitoringLocationId: null },
    versions: {
      dataVersion: payload.dataVersion, modelVersion: payload.method.version,
      satelliteConfigVersion: 'synthetic-satellites-1', aggregationVersion: 'synthetic-aggregation-1',
    },
    baselinePolicy: { version: payload.baseline.policyVersion, minimumValidYears: payload.baseline.minimumValidYears },
  };
  const job = {
    ...structuredClone(examples.job), status: 'running', resultId: null, completedAt: null,
    error: null, stage: 'publish', requestedById: 'synthetic-user', input,
  };
  // The client fixture uses the same context, but the foundation is explicit.
  job.id = payload.jobId;
  job.requestId = input.request.requestId;
  const attempt = {
    id: 'synthetic-attempt', jobId: job.id, workspaceId: job.workspaceId, attemptNo: 1,
    leaseToken: '33333333-3333-4333-8333-333333333333', status: 'succeeded',
    claimedAt: job.startedAt, heartbeatAt: job.startedAt,
    leaseExpiresAt: '2026-09-03T00:00:00.000Z', completedAt: payload.generatedAt,
    errorCode: null, retryable: null,
  };
  const manifest = {
    schemaVersion: 'research-manifest-1', id: payload.method.manifestId,
    workspaceId: job.workspaceId, jobId: job.id, dataVersion: payload.dataVersion,
    areaId: payload.area.id, areaRevision: payload.area.revision, geometryHash: payload.area.geometryHash,
    ...input.versions, qualityPolicyVersion: payload.qualityPolicyVersion,
    baselinePolicyVersion: payload.baseline.policyVersion,
    producerVersion: 'synthetic-producer-1', buildCommit: 'a'.repeat(40),
    pairingPolicyVersion: 'synthetic-pairing-1', missingnessPolicyVersion: 'synthetic-missingness-1',
    trainPeriod: null, testPeriod: null,
    sourceSnapshots: payload.sources.map((source) => ({
      sourceId: source.id, processingLevel: source.processingLevel, productVersion: source.version,
      checksum: source.checksum, batchIds: [], archiveRevision: 'synthetic-archive-1',
      ingestedAt: null,
    })),
  };
  const result = {
    id: payload.id, jobId: job.id, workspaceId: job.workspaceId,
    manifestId: manifest.id, dataVersion: payload.dataVersion,
    generatedAt: payload.generatedAt, publishedAt: payload.publishedAt, payload,
  };
  const artifact = {
    id: 'synthetic-artifact', resultId: result.id, workspaceId: job.workspaceId,
    kind: 'observations', periodRole: 'primary', objectKey: 'research/synthetic/observations.parquet',
    checksum: digest, bytes: 128, format: 'parquet',
  };
  const location = {
    ...structuredClone(examples.location), requestId, requestHash: digest,
    createdById: examples.location.createdBy.id,
    anchorDetectionId: examples.location.anchor.id,
  };
  location.initialAnalysisId = result.id;
  location.areaId = payload.area.id;
  location.areaRevision = payload.area.revision;
  return { job, attempt, manifest, result, artifacts: [artifact], location };
}
