import { z } from "zod";
import {
  createResearchAreaSchema,
  createResearchWorkspaceSchema,
  createResearchAnalysisSchema,
  researchAreaSchema,
  researchWorkspaceSchema,
  researchJobSchema,
  researchAnalysisResultSchema,
  researchDailyPageSchema,
  researchDetectionsPageSchema,
  researchErrorSchema,
  type ResearchJob,
  type ResearchAnalysisRequest,
} from "./research-contracts";

export class ResearchApiError extends Error {
  readonly code: string;
  readonly retryAfter: number;
  constructor(code: string, retryAfter = 2) {
    super(code);
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export async function researchRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  signal: AbortSignal,
  body?: unknown,
): Promise<T> {
  const timeout = AbortSignal.timeout(30000);
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.any([signal, timeout]),
  });
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = researchErrorSchema.safeParse(value);
    const retry = response.headers.get("Retry-After");
    const seconds =
      retry && /^\d+$/.test(retry)
        ? Number(retry)
        : retry
          ? (Date.parse(retry) - Date.now()) / 1000
          : 2;
    throw new ResearchApiError(
      parsed.success
        ? parsed.data.code
        : response.status === 401
          ? "UNAUTHENTICATED"
          : response.status === 403
            ? "FORBIDDEN"
            : response.status === 429
              ? "RATE_LIMITED"
              : "DEPENDENCY_UNAVAILABLE",
      Math.max(2, Number.isFinite(seconds) ? seconds : 2),
    );
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ResearchApiError("INVALID_RESPONSE");
  return parsed.data;
}

const root = (workspace: string) =>
  `/api/v2/workspaces/${encodeURIComponent(workspace)}`;
export const listResearchWorkspaces = (signal: AbortSignal) =>
  researchRequest(
    "/api/v2/workspaces",
    z.object({
      items: z.array(researchWorkspaceSchema),
      nextCursor: z.string().nullable(),
    }),
    signal,
  );
export const createResearchWorkspace = (body: z.infer<typeof createResearchWorkspaceSchema>, signal: AbortSignal) =>
  researchRequest("/api/v2/workspaces", researchWorkspaceSchema, signal, createResearchWorkspaceSchema.parse(body));
export async function createResearchArea(
  workspace: string,
  body: z.infer<typeof createResearchAreaSchema>,
  signal: AbortSignal,
) {
  const area = await researchRequest(
    `${root(workspace)}/areas`,
    researchAreaSchema,
    signal,
    createResearchAreaSchema.parse(body),
  );
  if (
    area.workspaceId !== workspace ||
    JSON.stringify(area.geometry) !== JSON.stringify(body.geometry)
  )
    throw new ResearchApiError("INVALID_RESPONSE");
  return area;
}
export async function submitResearch(
  workspace: string,
  body: ResearchAnalysisRequest,
  signal: AbortSignal,
) {
  const job = await researchRequest(
    `${root(workspace)}/analyses`,
    researchJobSchema,
    signal,
    createResearchAnalysisSchema.parse(body),
  );
  assertJobContext(job, workspace, body);
  return job;
}
export function assertJobContext(
  job: ResearchJob,
  workspace: string,
  body: ResearchAnalysisRequest,
) {
  if (
    job.workspaceId !== workspace ||
    job.requestId !== body.requestId ||
    job.areaId !== body.areaId ||
    job.areaRevision !== body.areaRevision
  )
    throw new ResearchApiError("INVALID_RESPONSE");
}
function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
export async function watchResearch(
  workspace: string,
  initial: ResearchJob,
  body: ResearchAnalysisRequest,
  signal: AbortSignal,
  onJob: (job: ResearchJob) => void,
) {
  assertJobContext(initial, workspace, body);
  let job = initial;
  let wait = 2000;
  while (job.status === "queued" || job.status === "running") {
    onJob(job);
    await delay(wait, signal);
    try {
      const next = await researchRequest(
        `${root(workspace)}/jobs/${encodeURIComponent(job.id)}`,
        researchJobSchema,
        signal,
      );
      assertJobContext(next, workspace, body);
      if (next.id !== initial.id || next.analysisKey !== initial.analysisKey)
        throw new ResearchApiError("INVALID_RESPONSE");
      job = next;
      wait = Math.min(wait * 1.5, 15000);
    } catch (error) {
      if (!(error instanceof ResearchApiError) || error.code !== "RATE_LIMITED")
        throw error;
      wait = error.retryAfter * 1000;
    }
  }
  onJob(job);
  if (job.status === "failed")
    throw new ResearchApiError(job.error?.code ?? "INTERNAL_ERROR");
  const result = await researchRequest(
    `${root(workspace)}/analyses/${encodeURIComponent(job.resultId!)}`,
    researchAnalysisResultSchema,
    signal,
  );
  if (
    result.id !== job.resultId ||
    result.jobId !== job.id ||
    result.workspaceId !== workspace ||
    result.area.id !== body.areaId ||
    result.area.revision !== body.areaRevision ||
    JSON.stringify(result.primary.period) !== JSON.stringify(body.period) ||
    JSON.stringify(result.comparison?.period ?? null) !==
      JSON.stringify(body.comparisonPeriod) ||
    result.baseline.windowYears !== body.baseline.windowYears ||
    result.qualityPolicyVersion !== body.qualityPolicyVersion
  )
    throw new ResearchApiError("INVALID_RESPONSE");
  return result;
}
export const researchDays = (
  workspace: string,
  analysisId: string,
  month: string,
  signal: AbortSignal,
) =>
  researchRequest(
    `${root(workspace)}/analyses/${encodeURIComponent(analysisId)}/days?${new URLSearchParams({ month, periodRole: "primary" })}`,
    researchDailyPageSchema,
    signal,
  );
export const researchDetections = (
  workspace: string,
  analysisId: string,
  signal: AbortSignal,
  cursor?: string,
) =>
  researchRequest(
    `${root(workspace)}/analyses/${encodeURIComponent(analysisId)}/detections?${new URLSearchParams({ periodRole: "primary", ...(cursor ? { cursor } : {}) })}`,
    researchDetectionsPageSchema,
    signal,
  );
