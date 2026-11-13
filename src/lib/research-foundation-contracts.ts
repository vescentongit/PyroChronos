import { z } from "zod";
import {
  createResearchAnalysisSchema,
  researchAreaSchema,
  researchJobSchema,
  researchPeriodSchema,
  researchAnalysisResultSchema,
  monitoringLocationSchema,
} from "./research-contracts.ts";

// Internal persistence/handoff contracts. They do not replace research-2 API DTOs.
// P0 identities remain opaque references until workspace/auth integration exists.
const id = z.string().trim().min(1).max(200);
// timestamptz(3) cannot preserve Python's default microsecond ISO serialization.
// Reject at the internal boundary rather than silently round immutable evidence.
const instant = z.string().datetime({ offset: true }).refine(
  (value) => !/\.\d{4,}/.test(value),
  "Persistence timestamps support at most millisecond precision",
);
const checksum = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const reject = (context: z.RefinementCtx, message: string) =>
  context.addIssue({ code: "custom", message });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const versions = z.object({
  dataVersion: id,
  modelVersion: id,
  satelliteConfigVersion: id,
  aggregationVersion: id,
}).strict();

export const analysisJobInputSchema = z.object({
  area: researchAreaSchema,
  request: createResearchAnalysisSchema,
  versions,
  baselinePolicy: z.object({ version: id, minimumValidYears: z.number().int().positive() }).strict(),
}).strict().superRefine((value, context) => {
  if (value.area.id !== value.request.areaId || value.area.revision !== value.request.areaRevision)
    reject(context, "Input AOI must match the requested revision");
  if (value.baselinePolicy.minimumValidYears > value.request.baseline.windowYears)
    reject(context, "Minimum history exceeds the reference window");
});

export const analysisJobRecordSchema = researchJobSchema.safeExtend({
  requestedById: id,
  input: analysisJobInputSchema,
  createdAt: instant,
  startedAt: instant.nullable(),
  completedAt: instant.nullable(),
}).superRefine((value, context) => {
  if (value.workspaceId !== value.input.area.workspaceId ||
      value.areaId !== value.input.area.id || value.areaRevision !== value.input.area.revision ||
      value.requestId !== value.input.request.requestId)
    reject(context, "Stored job context must match its frozen input");
});

export const analysisJobAttemptSchema = z.object({
  id, jobId: id, workspaceId: id,
  attemptNo: z.number().int().positive(),
  leaseToken: z.string().uuid(),
  status: z.enum(["running", "succeeded", "failed", "expired"]),
  claimedAt: instant,
  heartbeatAt: instant,
  leaseExpiresAt: instant,
  completedAt: instant.nullable(),
  errorCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/).nullable(),
  retryable: z.boolean().nullable(),
}).strict().superRefine((value, context) => {
  const claimed = Date.parse(value.claimedAt), heartbeat = Date.parse(value.heartbeatAt);
  const expires = Date.parse(value.leaseExpiresAt);
  const completed = value.completedAt === null ? null : Date.parse(value.completedAt);
  if (heartbeat < claimed || expires <= heartbeat)
    reject(context, "Lease must expire after a non-regressing heartbeat");
  if ((value.status === "running") !== (completed === null))
    reject(context, "Only a running attempt lacks completion time");
  if (completed !== null && completed < heartbeat)
    reject(context, "Completion precedes heartbeat");
  if (value.status === "succeeded" && completed !== null && completed >= expires)
    reject(context, "Success requires an unexpired lease");
  if (value.status === "expired" && completed !== null && completed < expires)
    reject(context, "Expired attempt must reach its lease deadline");
  const failed = value.status === "failed" || value.status === "expired";
  if (failed ? value.errorCode === null || value.retryable === null
    : value.errorCode !== null || value.retryable !== null)
    reject(context, "Only failed/expired attempts carry failure metadata");
});

export const analysisManifestSchema = z.object({
  schemaVersion: z.literal("research-manifest-1"),
  id, workspaceId: id, jobId: id,
  ...versions.shape,
  areaId: id, areaRevision: z.number().int().positive(), geometryHash: checksum,
  qualityPolicyVersion: id, baselinePolicyVersion: id,
  producerVersion: id, buildCommit: z.string().regex(/^[a-f0-9]{40}$/),
  pairingPolicyVersion: id, missingnessPolicyVersion: id,
  trainPeriod: researchPeriodSchema.nullable(), testPeriod: researchPeriodSchema.nullable(),
  sourceSnapshots: z.array(z.object({
    sourceId: id, processingLevel: z.enum(["NRT", "STANDARD"]), productVersion: id.nullable(),
    checksum: checksum.nullable(), batchIds: z.array(id), archiveRevision: id.nullable(),
    ingestedAt: instant.nullable(),
  }).strict()).min(1),
}).strict().superRefine((value, context) => {
  if (value.trainPeriod && value.testPeriod && value.trainPeriod.end >= value.testPeriod.start)
    reject(context, "Training must precede the inclusive held-out period");
  if ((value.trainPeriod === null) !== (value.testPeriod === null))
    reject(context, "Declare both training and test periods or neither");
  if (new Set(value.sourceSnapshots.map((source) => source.sourceId)).size !== value.sourceSnapshots.length)
    reject(context, "Duplicate source snapshot");
  for (const source of value.sourceSnapshots) {
    if (new Set(source.batchIds).size !== source.batchIds.length)
      reject(context, "Duplicate raw batch reference");
    if (source.checksum !== null && !source.batchIds.length && source.archiveRevision === null)
      reject(context, "Source bytes need batch or archive provenance");
  }
});

export const analysisResultRecordSchema = z.object({
  id, jobId: id, workspaceId: id, manifestId: id, dataVersion: id,
  generatedAt: instant, publishedAt: instant,
  payload: researchAnalysisResultSchema,
}).strict().superRefine((value, context) => {
  const p = value.payload;
  if (value.id !== p.id || value.jobId !== p.jobId || value.workspaceId !== p.workspaceId ||
      value.manifestId !== p.method.manifestId || value.dataVersion !== p.dataVersion ||
      Date.parse(value.generatedAt) !== Date.parse(p.generatedAt) ||
      Date.parse(value.publishedAt) !== Date.parse(p.publishedAt))
    reject(context, "Result columns must match the immutable payload");
  if (Date.parse(value.generatedAt) > Date.parse(value.publishedAt))
    reject(context, "Result generated after publication");
  if (!instant.safeParse(p.generatedAt).success || !instant.safeParse(p.publishedAt).success)
    reject(context, "Payload timestamps must preserve millisecond precision");
});

export const analysisArtifactSchema = z.object({
  id, resultId: id, workspaceId: id,
  kind: z.enum(["observations", "daily", "estimated_grid"]),
  periodRole: z.enum(["primary", "comparison"]),
  // Logical key only: no URLs, filesystem roots, escapes or traversal segments.
  objectKey: z.string().min(1).max(500).regex(/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_.-]+)*$/)
    .refine((key) => key.split("/").every((segment) => segment !== "." && segment !== "..")),
  checksum,
  bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  format: z.enum(["parquet", "json", "geojson"]),
}).strict();

// Prepared publication: the DB job is still running until the transaction commits.
export const analysisPublicationSchema = z.object({
  job: analysisJobRecordSchema,
  attempt: analysisJobAttemptSchema,
  manifest: analysisManifestSchema,
  result: analysisResultRecordSchema,
  artifacts: z.array(analysisArtifactSchema),
}).strict().superRefine(({ job, attempt, manifest, result, artifacts }, context) => {
  const p = result.payload, input = job.input;
  if (job.status !== "running" || attempt.status !== "succeeded")
    reject(context, "Publication requires a running job and completed attempt");
  if (attempt.jobId !== job.id || result.jobId !== job.id || manifest.jobId !== job.id ||
      [attempt.workspaceId, result.workspaceId, manifest.workspaceId].some((w) => w !== job.workspaceId))
    reject(context, "Publication mixes jobs or workspaces");
  if (manifest.id !== result.manifestId || manifest.areaId !== job.areaId ||
      manifest.areaRevision !== job.areaRevision || manifest.geometryHash !== input.area.geometryHash ||
      !same(p.area, input.area) || !same(p.primary.period, input.request.period) ||
      !same(p.comparison?.period ?? null, input.request.comparisonPeriod))
    reject(context, "Publication differs from the frozen area, periods or manifest");
  if (Object.entries(input.versions).some(([key, value]) => manifest[key as keyof typeof input.versions] !== value) ||
      result.dataVersion !== input.versions.dataVersion || p.method.version !== input.versions.modelVersion ||
      manifest.qualityPolicyVersion !== input.request.qualityPolicyVersion ||
      p.qualityPolicyVersion !== input.request.qualityPolicyVersion ||
      manifest.baselinePolicyVersion !== input.baselinePolicy.version ||
      p.baseline.policyVersion !== input.baselinePolicy.version ||
      p.baseline.minimumValidYears !== input.baselinePolicy.minimumValidYears ||
      p.baseline.windowYears !== input.request.baseline.windowYears)
    reject(context, "Publication versions or baseline policy differ from input");
  if (Date.parse(attempt.claimedAt) < Date.parse(job.startedAt!) ||
      Date.parse(result.generatedAt) < Date.parse(attempt.claimedAt) ||
      Date.parse(result.publishedAt) < Date.parse(attempt.completedAt!) ||
      Date.parse(result.publishedAt) >= Date.parse(attempt.leaseExpiresAt))
    reject(context, "Publication timestamps precede execution");
  if (manifest.sourceSnapshots.length !== p.sources.length || p.sources.some((source) => {
    const snapshot = manifest.sourceSnapshots.find((s) => s.sourceId === source.id);
    return !snapshot || snapshot.checksum !== source.checksum || snapshot.processingLevel !== source.processingLevel ||
      (snapshot.productVersion ?? "unknown") !== source.version;
  })) reject(context, "Manifest source snapshots differ from the result");
  if (new Set(artifacts.map((a) => a.id)).size !== artifacts.length ||
      new Set(artifacts.map((a) => a.objectKey)).size !== artifacts.length)
    reject(context, "Duplicate artifact identity");
  if (artifacts.some((a) => a.resultId !== result.id || a.workspaceId !== job.workspaceId ||
      (a.periodRole === "comparison" && p.comparison === null)))
    reject(context, "Artifact scope differs from the result");
});

export const monitoringLocationRecordSchema = monitoringLocationSchema.safeExtend({
  requestId: z.string().uuid(), requestHash: checksum,
  createdById: id, anchorDetectionId: id,
  createdAt: instant,
  name: z.string().trim().min(1).max(200),
}).superRefine((value, context) => {
  if (value.createdById !== value.createdBy.id || value.anchorDetectionId !== value.anchor.id)
    reject(context, "Location must preserve its original creator and observation identity");
});

export const monitoringLocationAnalysisSchema = z.object({
  locationId: id, workspaceId: id, analysisId: id, createdAt: instant,
}).strict();

export type P1AnalysisJobInput = z.infer<typeof analysisJobInputSchema>;
export type P1AnalysisJobRecord = z.infer<typeof analysisJobRecordSchema>;
export type P1AnalysisJobAttempt = z.infer<typeof analysisJobAttemptSchema>;
export type AnalysisManifest = z.infer<typeof analysisManifestSchema>;
export type AnalysisResultRecord = z.infer<typeof analysisResultRecordSchema>;
export type P1AnalysisArtifact = z.infer<typeof analysisArtifactSchema>;
export type AnalysisPublication = z.infer<typeof analysisPublicationSchema>;
export type MonitoringLocationRecord = z.infer<typeof monitoringLocationRecordSchema>;
export type MonitoringLocationAnalysis = z.infer<typeof monitoringLocationAnalysisSchema>;
