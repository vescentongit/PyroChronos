import { z } from "zod";
import { createResearchAreaSchema, createResearchWorkspaceSchema, researchAreaSchema, researchAnalysisResultSchema, researchDailyPageSchema, researchDetectionsPageSchema, researchJobSchema, type ResearchAnalysisRequest, type ResearchJob } from "./research-contracts";
import { ResearchApiError } from "./research-client";

const workspaceKey = "pyro-local-workspace-v1";
const areaKey = "pyro-local-areas-v1";
const historyKey = "pyro-research-history-v1";
const bundleSchema = z.object({ result: researchAnalysisResultSchema, manifest: z.record(z.string(), z.unknown()), days: z.array(researchDailyPageSchema), detections: z.array(researchDetectionsPageSchema) }).strict();
type Bundle = z.infer<typeof bundleSchema>;

function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("pyro-research-v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("results", { keyPath: "result.id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new ResearchApiError("STORAGE_UNAVAILABLE"));
    request.onblocked = () => reject(new ResearchApiError("STORAGE_UNAVAILABLE"));
  });
}
export async function getBundle(id: string): Promise<Bundle> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("results").objectStore("results").get(id);
      request.onsuccess = () => { const parsed = bundleSchema.safeParse(request.result); parsed.success ? resolve(parsed.data) : reject(new ResearchApiError("INVALID_RESPONSE")); };
      request.onerror = () => reject(new ResearchApiError("STORAGE_UNAVAILABLE"));
    });
  } finally { db.close(); }
}
async function saveBundle(bundle: Bundle) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("results", "readwrite");
      tx.objectStore("results").put(bundle);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(new ResearchApiError("STORAGE_UNAVAILABLE"));
    });
    const history = researchHistory();
    const summary = { id: bundle.result.id, name: bundle.result.area.name, start: bundle.result.primary.period.start, end: bundle.result.primary.period.end };
    localStorage.setItem(historyKey, JSON.stringify([summary, ...history.filter(item => item.id !== summary.id)]));
    localStorage.setItem("pyro-last-research-v1", bundle.result.id);
  } finally { db.close(); }
}
async function request(body: unknown, signal: AbortSignal) {
  const response = await fetch("/api/local-research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(250_000)]) });
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new ResearchApiError(typeof value?.code === "string" ? value.code : "DEPENDENCY_UNAVAILABLE");
  return value;
}
export async function listResearchWorkspaces(signal: AbortSignal) {
  signal.throwIfAborted();
  let workspace = localStorage.getItem(workspaceKey);
  if (!workspace) {
    workspace = JSON.stringify({ schemaVersion: "research-2", id: crypto.randomUUID(), name: "Local workspace", createdAt: new Date().toISOString(), createdBy: { id: "local", displayName: null } });
    localStorage.setItem(workspaceKey, workspace);
  }
  return { items: [JSON.parse(workspace)], nextCursor: null };
}
export async function createResearchWorkspace(body: z.infer<typeof createResearchWorkspaceSchema>, signal: AbortSignal) {
  signal.throwIfAborted();
  const input = createResearchWorkspaceSchema.parse(body);
  const workspace = { schemaVersion: "research-2", id: crypto.randomUUID(), name: input.name, createdAt: new Date().toISOString(), createdBy: { id: "local", displayName: null } };
  localStorage.setItem(workspaceKey, JSON.stringify(workspace));
  return workspace;
}
export async function createResearchArea(workspaceId: string, body: z.infer<typeof createResearchAreaSchema>, signal: AbortSignal) {
  const area = researchAreaSchema.parse(await request({ action: "area", workspaceId, area: createResearchAreaSchema.parse(body) }, signal));
  if (area.workspaceId !== workspaceId || JSON.stringify(area.geometry) !== JSON.stringify(body.geometry)) throw new ResearchApiError("INVALID_RESPONSE");
  const areas = JSON.parse(localStorage.getItem(areaKey) || "{}");
  areas[area.id] = area;
  localStorage.setItem(areaKey, JSON.stringify(areas));
  return area;
}
export async function submitResearch(workspaceId: string, body: ResearchAnalysisRequest, signal: AbortSignal) {
  const area = researchAreaSchema.parse(JSON.parse(localStorage.getItem(areaKey) || "{}")[body.areaId]);
  const bundle = bundleSchema.parse(await request({ action: "analyze", workspaceId, area, request: body }, signal));
  if (bundle.result.workspaceId !== workspaceId || bundle.result.area.id !== body.areaId || bundle.result.primary.period.start !== body.period.start || bundle.result.primary.period.end !== body.period.end) throw new ResearchApiError("INVALID_RESPONSE");
  signal.throwIfAborted();
  await saveBundle(bundle);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(body)));
  const analysisKey = `sha256:${Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, "0")).join("")}`;
  const now = new Date().toISOString();
  return researchJobSchema.parse({ schemaVersion: "research-2", id: bundle.result.jobId, workspaceId, requestId: body.requestId, analysisKey, areaId: body.areaId, areaRevision: body.areaRevision, status: "succeeded", stage: null, progressPercent: null, createdAt: now, startedAt: now, completedAt: now, resultId: bundle.result.id, error: null });
}
export async function watchResearch(_workspace: string, job: ResearchJob, _body: ResearchAnalysisRequest, signal: AbortSignal, onJob: (job: ResearchJob) => void) {
  signal.throwIfAborted(); onJob(job); return (await getBundle(job.resultId!)).result;
}
export async function researchDays(_workspace: string, id: string, month: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const page = (await getBundle(id)).days.find(item => item.periodRole === "primary" && item.month === month);
  if (!page) throw new ResearchApiError("INVALID_REQUEST");
  return page;
}
export async function researchDetections(_workspace: string, id: string, signal: AbortSignal, cursor?: string) {
  signal.throwIfAborted();
  const pages = (await getBundle(id)).detections.filter(item => item.periodRole === "primary");
  const index = cursor ? Number(cursor) : 0;
  if (!Number.isSafeInteger(index) || index < 0 || index >= pages.length) throw new ResearchApiError("INVALID_REQUEST");
  return { ...pages[index], nextCursor: index + 1 < pages.length ? String(index + 1) : null };
}
export async function lastResearchResult() {
  const id = localStorage.getItem("pyro-last-research-v1");
  return id ? (await getBundle(id)).result : null;
}
const historySchema = z.array(z.object({ id: z.string(), name: z.string(), start: z.string(), end: z.string() }).strict());
export function researchHistory() {
  return historySchema.parse(JSON.parse(localStorage.getItem(historyKey) || "[]"));
}
export async function openResearchResult(id: string) {
  const result = (await getBundle(id)).result;
  localStorage.setItem("pyro-last-research-v1", id);
  return result;
}
