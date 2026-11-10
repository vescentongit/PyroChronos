import { z } from "zod";

// Target API v2. Existing v1 consumers remain unchanged until their migration.
const id = z.string().trim().min(1).max(200);
const instant = z.string().datetime({ offset: true });
const date = z.iso
  .date()
  .refine((value) => value >= "2000-01-01", "Before research archive target");
const count = z.number().finite().nonnegative();
const coordinates = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);
const requestId = z.string().uuid();
const periodRole = z.enum(["primary", "comparison"]);
const actor = z.object({ id, displayName: z.string().nullable() }).strict();
const reason = z.string().trim().min(1).max(500);
const issue = (context: z.RefinementCtx, message: string) =>
  context.addIssue({ code: "custom", message });

export const createResearchWorkspaceSchema = z
  .object({ requestId, name: z.string().trim().min(1).max(200) })
  .strict();
export const researchWorkspaceSchema = z
  .object({
    schemaVersion: z.literal("research-2"),
    id,
    name: z.string().min(1),
    createdAt: instant,
    createdBy: actor,
  })
  .strict();
export const updateResearchMembershipSchema = z
  .object({
    requestId,
    expectedRevision: z.number().int().positive().nullable(),
    role: z.enum(["owner", "member"]),
    active: z.boolean(),
  })
  .strict();
export const researchMembershipSchema = z
  .object({
    schemaVersion: z.literal("research-2"),
    workspaceId: id,
    user: actor,
    role: z.enum(["owner", "member"]),
    active: z.boolean(),
    revision: z.number().int().positive(),
  })
  .strict();

export const researchPeriodSchema = z
  .object({ start: date, end: date })
  .strict()
  .refine((value) => value.start <= value.end, "Period start after end");

export const researchPolygonSchema = z
  .object({
    type: z.literal("Polygon"),
    coordinates: z.array(z.array(coordinates).min(4)).min(1),
  })
  .strict()
  .superRefine((polygon, context) => {
    for (const ring of polygon.coordinates) {
      const first = ring[0],
        last = ring.at(-1)!;
      if (first[0] !== last[0] || first[1] !== last[1])
        issue(context, "Polygon ring must be closed");
      if (new Set(ring.slice(0, -1).map((point) => point.join(","))).size < 3)
        issue(context, "Polygon ring requires three distinct vertices");
    }
  });

export const createResearchAreaSchema = z
  .object({
    requestId,
    name: z.string().trim().min(1).max(200),
    geometry: researchPolygonSchema,
  })
  .strict();
export const researchAreaSchema = z
  .object({
    schemaVersion: z.literal("research-2"),
    id,
    workspaceId: id,
    revision: z.number().int().positive(),
    name: z.string().min(1),
    geometry: researchPolygonSchema,
    geometryHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    areaKm2: z.number().finite().positive(),
    createdAt: instant,
  })
  .strict();

const baselineRequest = z
  .object({
    kind: z.literal("rolling-same-calendar-period"),
    windowYears: z.number().int().positive().default(10),
  })
  .strict();
export const createResearchAnalysisSchema = z
  .object({
    requestId,
    areaId: id,
    areaRevision: z.number().int().positive(),
    period: researchPeriodSchema,
    comparisonPeriod: researchPeriodSchema.nullable(),
    baseline: baselineRequest,
    referenceScale: z.literal("MODIS-equivalent"),
    qualityPolicyVersion: id,
    monitoringLocationId: id.nullable(),
  })
  .strict();

export const researchErrorSchema = z
  .object({
    schemaVersion: z.literal("research-2"),
    error: z.string().min(1),
    code: z.enum([
      "INVALID_REQUEST",
      "UNAUTHENTICATED",
      "FORBIDDEN",
      "NOT_FOUND",
      "RESULT_NOT_READY",
      "DEPENDENCY_UNAVAILABLE",
      "RATE_LIMITED",
      "IDEMPOTENCY_CONFLICT",
      "REVISION_CONFLICT",
      "CAPACITY_LIMIT",
      "INTERNAL_ERROR",
    ]),
    retryable: z.boolean(),
    requestId: z.string().nullable(),
  })
  .strict();

export const researchJobSchema = z
  .object({
    schemaVersion: z.literal("research-2"),
    id,
    workspaceId: id,
    requestId,
    analysisKey: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    areaId: id,
    areaRevision: z.number().int().positive(),
    status: z.enum(["queued", "running", "succeeded", "failed"]),
    stage: z
      .enum(["ingest", "aggregate", "harmonize", "evaluate", "publish"])
      .nullable(),
    progressPercent: z.number().min(0).max(100).nullable(),
    createdAt: instant,
    startedAt: instant.nullable(),
    completedAt: instant.nullable(),
    resultId: id.nullable(),
    error: researchErrorSchema.nullable(),
  })
  .strict()
  .superRefine((job, context) => {
    const terminal = job.status === "succeeded" || job.status === "failed";
    if (terminal !== (job.completedAt !== null))
      issue(context, "Terminal job requires completion time only");
    if ((job.status === "succeeded") !== (job.resultId !== null))
      issue(context, "Only succeeded job exposes a result");
    if ((job.status === "failed") !== (job.error !== null))
      issue(context, "Only failed job exposes an error");
    if (job.status === "queued" && job.startedAt !== null)
      issue(context, "Queued job has not started");
    if (
      (job.status === "running" || job.status === "succeeded") &&
      job.startedAt === null
    )
      issue(context, "Started job needs startedAt");
    if (job.startedAt && Date.parse(job.startedAt) < Date.parse(job.createdAt))
      issue(context, "Started before creation");
    if (
      job.completedAt &&
      Date.parse(job.completedAt) < Date.parse(job.startedAt ?? job.createdAt)
    )
      issue(context, "Completed before start");
  });

const metric = z
  .object({
    rawCount: count.int().nullable(),
    harmonizedCount: count.nullable(),
    rawCountsBySource: z.record(z.string().min(1), count.int().nullable()),
    status: z.enum(["available", "partial", "no_data", "method_unsupported"]),
  })
  .strict()
  .superRefine((value, context) => {
    const sourceCounts = Object.values(value.rawCountsBySource);
    if (
      value.rawCount !== null &&
      sourceCounts.reduce<number>((sum, n) => sum + (n ?? 0), 0) !==
        value.rawCount
    )
      issue(context, "Raw source counts must sum to received raw count");
    if (
      value.status === "no_data" &&
      (value.rawCount !== null || value.harmonizedCount !== null)
    )
      issue(context, "Missing data cannot become zero");
    if (value.status === "no_data" && sourceCounts.some((n) => n !== null))
      issue(context, "Missing source counts must be null");
    if (value.status === "method_unsupported" && value.harmonizedCount !== null)
      issue(context, "Unsupported method cannot publish harmonized count");
    if (
      value.status === "available" &&
      (value.rawCount === null || value.harmonizedCount === null)
    )
      issue(context, "Available metric requires counts");
  });
const anomaly = z
  .object({
    status: z.enum([
      "assessed",
      "insufficient_history",
      "insufficient_data",
      "method_unsupported",
    ]),
    referenceYears: z.array(z.number().int().min(2000)),
    baselineStatistic: z.enum(["mean", "median"]).nullable(),
    baselineValue: count.nullable(),
    delta: z.number().finite().nullable(),
    scoreKind: z.enum(["percentile", "z-score"]).nullable(),
    score: z.number().finite().nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.referenceYears).size !== value.referenceYears.length)
      issue(context, "Duplicate reference year");
    if (
      value.status !== "assessed" &&
      [value.baselineValue, value.delta, value.score].some((v) => v !== null)
    )
      issue(context, "Unassessed anomaly must not publish a value");
    if (
      value.status === "assessed" &&
      (value.baselineValue === null ||
        value.baselineStatistic === null ||
        value.delta === null)
    )
      issue(context, "Assessed anomaly requires a baseline and difference");
    if ((value.score === null) !== (value.scoreKind === null))
      issue(context, "Score and scoreKind must agree");
    if (
      value.scoreKind === "percentile" &&
      (value.score! < 0 || value.score! > 100)
    )
      issue(context, "Percentile out of range");
  });
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const summary = z
  .object({
    period: researchPeriodSchema,
    days: z.number().int().positive(),
    metric,
  })
  .strict();

export const researchAnalysisResultSchema = z
  .object({
    schemaVersion: z.literal("research-2"),
    id,
    jobId: id,
    workspaceId: id,
    mode: z.enum(["research", "replay", "demo"]),
    area: researchAreaSchema,
    primary: summary,
    comparison: summary.nullable(),
    baseline: z
      .object({
        kind: z.literal("rolling-same-calendar-period"),
        windowYears: z.number().int().positive(),
        minimumValidYears: z.number().int().positive(),
        policyVersion: id,
      })
      .strict(),
    method: z
      .object({
        name: id,
        version: id,
        referenceScale: z.literal("MODIS-equivalent"),
        unit: z.literal("estimated-hotspot-detections"),
        validation: z.enum(["validated", "not-evaluated", "unsupported"]),
        validationDomain: z.string().min(1),
        manifestId: id,
      })
      .strict(),
    sources: z
      .array(
        z
          .object({
            id,
            product: id,
            version: id,
            processingLevel: z.enum(["NRT", "STANDARD"]),
            status: z.enum(["available", "partial", "unavailable"]),
            observedFrom: instant.nullable(),
            observedTo: instant.nullable(),
            checksum: z
              .string()
              .regex(/^sha256:[a-f0-9]{64}$/)
              .nullable(),
          })
          .strict(),
      )
      .min(1),
    dataVersion: id,
    qualityPolicyVersion: id,
    generatedAt: instant,
    publishedAt: instant,
    months: z.array(
      z
        .object({
          month,
          metric,
          anomaly,
          isPartialPeriod: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.workspaceId !== result.area.workspaceId)
      issue(context, "Result and area workspace mismatch");
    if (Date.parse(result.publishedAt) < Date.parse(result.generatedAt))
      issue(context, "Published before generation");
    if (result.baseline.minimumValidYears > result.baseline.windowYears)
      issue(context, "Minimum history exceeds window");
    for (const item of [result.primary, result.comparison].filter(
      (v) => v !== null,
    )) {
      const days =
        (Date.parse(item.period.end) - Date.parse(item.period.start)) /
          86400000 +
        1;
      if (item.days !== days)
        issue(context, "Inclusive UTC day count mismatch");
    }
    const months = result.months.map((entry) => entry.month);
    if (
      new Set(months).size !== months.length ||
      months.some((value, index) => index > 0 && value <= months[index - 1])
    )
      issue(context, "Calendar months must be unique and ordered");
    const expectedMonths: string[] = [];
    const cursor = new Date(
      `${result.primary.period.start.slice(0, 7)}-01T00:00:00Z`,
    );
    const endMonth = result.primary.period.end.slice(0, 7);
    while (cursor.toISOString().slice(0, 7) <= endMonth) {
      expectedMonths.push(cursor.toISOString().slice(0, 7));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    if (months.join(",") !== expectedMonths.join(","))
      issue(
        context,
        "Calendar must include all requested months, including no_data",
      );
    for (const entry of result.months) {
      if (
        entry.month < result.primary.period.start.slice(0, 7) ||
        entry.month > result.primary.period.end.slice(0, 7)
      )
        issue(context, "Calendar month outside primary period");
      const targetYear = Number(entry.month.slice(0, 4));
      if (
        entry.anomaly.referenceYears.some(
          (year) =>
            year >= targetYear ||
            year < targetYear - result.baseline.windowYears,
        )
      )
        issue(
          context,
          "Reference years must precede target within rolling window",
        );
      if (
        entry.anomaly.status === "assessed" &&
        entry.anomaly.referenceYears.length < result.baseline.minimumValidYears
      )
        issue(context, "Insufficient reference years cannot be assessed");
      if (
        entry.anomaly.status === "assessed" &&
        entry.metric.harmonizedCount === null
      )
        issue(context, "Anomaly requires harmonized activity");
      if (
        entry.anomaly.status === "assessed" &&
        Math.abs(
          entry.anomaly.delta! -
            (entry.metric.harmonizedCount! - entry.anomaly.baselineValue!),
        ) > 1e-8
      )
        issue(context, "Anomaly difference must match baseline and activity");
    }
    for (const field of ["rawCount", "harmonizedCount"] as const) {
      if (
        result.months.every((entry) => entry.metric[field] !== null) &&
        result.primary.metric[field] !== null
      ) {
        const total = result.months.reduce(
          (sum, entry) => sum + entry.metric[field]!,
          0,
        );
        if (Math.abs(total - result.primary.metric[field]) > 1e-8)
          issue(context, "Calendar totals do not match primary summary");
      }
    }
    const allMetrics = [
      result.primary.metric,
      result.comparison?.metric,
      ...result.months.map((entry) => entry.metric),
    ].filter(Boolean);
    const sourceIds = result.sources
      .map((source) => source.id)
      .sort()
      .join(",");
    if (
      new Set(result.sources.map((source) => source.id)).size !==
      result.sources.length
    )
      issue(context, "Duplicate source ID");
    if (
      allMetrics.some(
        (entry) =>
          Object.keys(entry!.rawCountsBySource).sort().join(",") !== sourceIds,
      )
    )
      issue(
        context,
        "Raw counts must declare every configured source, including unavailable ones",
      );
    if (
      result.method.validation === "unsupported" &&
      allMetrics.some((entry) => entry!.harmonizedCount !== null)
    )
      issue(context, "Unsupported method cannot publish estimates");
    if (
      result.mode === "research" &&
      result.method.validation !== "validated" &&
      allMetrics.some((entry) => entry!.harmonizedCount !== null)
    )
      issue(
        context,
        "Research estimates require validation; experimental output must be replay/demo",
      );
  });

export const researchDailyPageSchema = z
  .object({
    schemaVersion: z.literal("research-2"),
    analysisId: id,
    periodRole,
    month,
    days: z.array(z.object({ date, metric, anomaly }).strict()),
    nextCursor: z.string().nullable(),
  })
  .strict()
  .superRefine((page, context) => {
    const dates = page.days.map((day) => day.date);
    if (
      dates.some((day) => !day.startsWith(page.month)) ||
      new Set(dates).size !== dates.length
    )
      issue(context, "Daily page must contain unique dates in requested month");
  });

const observation = z
  .object({
    id,
    sourceId: id,
    observedAt: instant,
    coordinates,
    confidence: z.string(),
    frpMw: count.nullable(),
  })
  .strict();
export const researchDetectionsPageSchema = z
  .object({
    schemaVersion: z.literal("research-2"),
    analysisId: id,
    periodRole,
    observations: z.array(observation).max(1000),
    nextCursor: z.string().nullable(),
  })
  .strict();
export const createMonitoringLocationSchema = z
  .object({
    requestId,
    analysisId: id,
    anchorDetectionId: id,
    name: z.string().trim().min(1).max(200),
  })
  .strict();
export const monitoringLocationSchema = z
  .object({
    schemaVersion: z.literal("research-2"),
    id,
    workspaceId: id,
    name: z.string().min(1),
    anchor: observation,
    initialAnalysisId: id,
    areaId: id,
    areaRevision: z.number().int().positive(),
    createdAt: instant,
    createdBy: actor,
  })
  .strict();

export const createInspectionAssignmentSchema = z
  .object({ requestId, assigneeUserId: id })
  .strict();
const assignmentStatus = z.enum([
  "assigned",
  "in_progress",
  "completed",
  "cancelled",
]);
export const updateInspectionAssignmentSchema = z
  .object({
    requestId,
    expectedRevision: z.number().int().positive(),
    status: assignmentStatus,
  })
  .strict();
export const inspectionAssignmentSchema = z
  .object({
    schemaVersion: z.literal("research-2"),
    id,
    workspaceId: id,
    locationId: id,
    assignee: actor,
    assignedBy: actor,
    status: assignmentStatus,
    revision: z.number().int().positive(),
    createdAt: instant,
    updatedAt: instant,
  })
  .strict();

const reportFields = {
  inspectorUserId: id,
  observedAt: instant,
  outcome: z.enum([
    "fire_or_smoke_found",
    "no_sign_at_inspection",
    "inconclusive",
  ]),
  notes: z.string().max(2000),
};
export const createResearchReportSchema = z
  .object({ requestId, ...reportFields })
  .strict();
export const correctResearchReportSchema = z
  .object({
    requestId,
    expectedRevision: z.number().int().positive(),
    reason,
    ...reportFields,
  })
  .strict();
export const researchReportSchema = z
  .object({
    schemaVersion: z.literal("research-2"),
    id,
    workspaceId: id,
    locationId: id,
    assignmentId: id,
    ...reportFields,
    recordedBy: actor,
    revision: z.number().int().positive(),
    createdAt: instant,
    updatedAt: instant,
    corrections: z.array(
      z
        .object({
          revision: z.number().int().positive(),
          requestId,
          reason,
          correctedAt: instant,
          correctedBy: actor,
          ...reportFields,
        })
        .strict(),
    ),
  })
  .strict();

export const createResearchExportSchema = z
  .object({
    requestId,
    analysisId: id,
    periodRole,
    kind: z.enum(["raw-hotspots-csv", "harmonized-aggregates-csv"]),
  })
  .strict();
export const researchExportSchema = z
  .object({
    schemaVersion: z.literal("research-2"),
    id,
    workspaceId: id,
    analysisId: id,
    periodRole,
    kind: z.enum(["raw-hotspots-csv", "harmonized-aggregates-csv"]),
    status: z.enum(["queued", "running", "ready", "failed"]),
    downloadPath: z.string().startsWith("/api/v2/").nullable(),
    error: researchErrorSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.status === "ready") !== (value.downloadPath !== null))
      issue(context, "Only ready export has download path");
    if ((value.status === "failed") !== (value.error !== null))
      issue(context, "Only failed export has error");
  });

export const researchContracts = {
  "workspace-create": createResearchWorkspaceSchema,
  workspace: researchWorkspaceSchema,
  "membership-update": updateResearchMembershipSchema,
  membership: researchMembershipSchema,
  "area-create": createResearchAreaSchema,
  area: researchAreaSchema,
  "analysis-create": createResearchAnalysisSchema,
  job: researchJobSchema,
  result: researchAnalysisResultSchema,
  "daily-page": researchDailyPageSchema,
  "detections-page": researchDetectionsPageSchema,
  "location-create": createMonitoringLocationSchema,
  location: monitoringLocationSchema,
  "assignment-create": createInspectionAssignmentSchema,
  "assignment-update": updateInspectionAssignmentSchema,
  assignment: inspectionAssignmentSchema,
  "report-create": createResearchReportSchema,
  "report-correction": correctResearchReportSchema,
  report: researchReportSchema,
  "export-create": createResearchExportSchema,
  export: researchExportSchema,
  error: researchErrorSchema,
};
export type ResearchAnalysisRequest = z.infer<
  typeof createResearchAnalysisSchema
>;
export type ResearchAnalysisResult = z.infer<
  typeof researchAnalysisResultSchema
>;
export type ResearchJob = z.infer<typeof researchJobSchema>;
