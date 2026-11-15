import { z } from "zod";
import { createResearchAreaSchema, createResearchWorkspaceSchema, researchAreaSchema, researchJobSchema, type ResearchAnalysisRequest, type ResearchJob } from "./research-contracts";
import { ResearchApiError } from "./research-client";
import { combineResearchStages, contentHash, localBundleSchema, researchStages, type StageProgress } from "./research-stages";

const workspaceKey = "pyro-local-workspace-v1";
const areaKey = "pyro-local-areas-v1";
const historyKey = "pyro-research-history-v1";
const bundleSchema = localBundleSchema;
type Bundle = z.infer<typeof bundleSchema>;
let bundleCache: { id: string; promise: Promise<Bundle> } | undefined;

export const localResearchRetentionPolicy = Object.freeze({persistedTtlDays:null,activeBundleCacheEntries:1,automaticPersistedEviction:false});
export function releaseLocalResearchCache() { bundleCache=undefined; }
export async function localResearchStorageCapacity() {
  const estimate=await globalThis.navigator?.storage?.estimate?.();
  return {usage:estimate?.usage??null,quota:estimate?.quota??null,automaticPersistedEviction:false};
}

function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("pyro-research-v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("results", { keyPath: "result.id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new ResearchApiError("STORAGE_UNAVAILABLE"));
    request.onblocked = () => reject(new ResearchApiError("STORAGE_UNAVAILABLE"));
  }).catch(() => { throw new ResearchApiError("STORAGE_UNAVAILABLE"); });
}
export function getBundle(id: string): Promise<Bundle> {
  // Results are immutable; retain only the active bundle to bound memory use.
  if (bundleCache?.id === id) return bundleCache.promise;
  const promise = readBundle(id).catch(error => {
    if (bundleCache?.promise === promise) bundleCache = undefined;
    throw error;
  });
  bundleCache = { id, promise };
  return promise;
}
async function readBundle(id: string): Promise<Bundle> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("results").objectStore("results").get(id);
      request.onsuccess = () => {
        const stored = request.result;
        const payload = stored?.localStageOnly === true ? { result: stored.result, manifest: stored.manifest, days: stored.days, detections: stored.detections } : stored;
        const parsed = bundleSchema.safeParse(payload);
        parsed.success ? resolve(parsed.data) : reject(new ResearchApiError("INVALID_RESPONSE"));
      };
      request.onerror = () => reject(new ResearchApiError("STORAGE_UNAVAILABLE"));
    });
  } catch (error) {
    throw error instanceof ResearchApiError ? error : new ResearchApiError("STORAGE_UNAVAILABLE");
  } finally { db.close(); }
}
async function saveBundle(bundle: Bundle, recordHistory = true) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("results", "readwrite");
      // Keep resumable checkpoints durable, but distinguish them from complete analyses.
      tx.objectStore("results").put(recordHistory ? bundle : { ...bundle, localStageOnly: true });
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(new ResearchApiError("STORAGE_UNAVAILABLE"));
    });
    if (bundleCache?.id === bundle.result.id) bundleCache = undefined;
    if (!recordHistory) return;
    const history = researchHistory();
    const summary = { id: bundle.result.id, name: bundle.result.area.name, start: bundle.result.primary.period.start, end: bundle.result.primary.period.end };
    localStorage.setItem(historyKey, JSON.stringify([summary, ...history.filter(item => item.id !== summary.id)]));
    localStorage.setItem("pyro-last-research-v1", bundle.result.id);
    if (typeof window !== "undefined") window.dispatchEvent(new Event("pyro-research-updated"));
  } catch (error) {
    throw error instanceof ResearchApiError ? error : new ResearchApiError("STORAGE_UNAVAILABLE");
  } finally { db.close(); }
}
async function request(body: unknown, signal: AbortSignal) {
  const response = await fetch("/api/local-research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.any([signal, AbortSignal.timeout(250_000)]) });
  const value = await response.json().catch(() => null);
  if (!response.ok) {
    const retry = response.headers.get("Retry-After");
    const seconds = retry && /^\d+$/.test(retry) ? Number(retry) : 2;
    throw new ResearchApiError(typeof value?.code === "string" ? value.code : response.status === 429 ? "RATE_LIMITED" : "DEPENDENCY_UNAVAILABLE", Number.isSafeInteger(seconds) ? Math.max(2, seconds) : 2);
  }
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
export async function submitResearch(workspaceId: string, body: ResearchAnalysisRequest, signal: AbortSignal, options: { refresh?: boolean; onProgress?: (progress: StageProgress[]) => void } = {}) {
  const area = researchAreaSchema.parse(JSON.parse(localStorage.getItem(areaKey) || "{}")[body.areaId]);
  const stages = researchStages(body);
  const progress: StageProgress[] = stages.map(stage => ({ stage, status: "pending" }));
  const completed: Parameters<typeof combineResearchStages>[2] = [];
  let bytes = 0, observations = 0;
  const report = () => options.onProgress?.(progress.map(item => ({ ...item })));
  report();
  for (const [index, stage] of stages.entries()) {
    signal.throwIfAborted();
    progress[index].status = "loading";
    report();
    try {
      const key = `pyro-stage-v1-${await contentHash({ workspaceId, geometry: area.geometry, name: area.name, ...stage, baseline: body.baseline, quality: body.qualityPolicyVersion })}`;
      const saved = options.refresh ? null : localStorage.getItem(key);
      let part: Bundle | undefined;
      if (saved) {
        try { part = await readBundle(saved); }
        catch (error) { if (!(error instanceof ResearchApiError) || error.code !== "INVALID_RESPONSE") throw error; }
      }
      if (!part) {
        const selected = { ...body, requestId: crypto.randomUUID(), period: stage.period, comparisonPeriod: null };
        part = bundleSchema.parse(await request({ action: "analyze", workspaceId, area, request: selected, includeBaseline: stage.role === "primary" }, signal));
        if (part.result.workspaceId !== workspaceId || JSON.stringify(part.result.area) !== JSON.stringify(area) || part.result.comparison !== null || JSON.stringify(part.result.primary.period) !== JSON.stringify(stage.period)) throw new ResearchApiError("INVALID_RESPONSE");
        signal.throwIfAborted();
        await saveBundle(part, false);
        try { localStorage.setItem(key, part.result.id); }
        catch { throw new ResearchApiError("STORAGE_UNAVAILABLE"); }
      }
      bytes += new TextEncoder().encode(JSON.stringify(part)).byteLength;
      observations += part.detections.reduce((sum, page) => sum + page.observations.length, 0);
      // shortcut: one assembled result holds at most 32 MB/100k observations; use paged results for larger studies.
      if (bytes > 32_000_000 || observations > 100_000) throw new ResearchApiError("CAPACITY_LIMIT");
      completed.push({ stage, bundle: part });
      progress[index] = { stage, status: "saved", metric: part.result.primary.metric };
      report();
    } catch (error) {
      progress[index].status = "failed";
      report();
      throw error;
    }
  }
  let bundle: Bundle;
  try { bundle = await combineResearchStages(area, body, completed); }
  catch { throw new ResearchApiError("INVALID_RESPONSE"); }
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
  let id = localStorage.getItem("pyro-last-research-v1");
  if (!id) { await recoverLocalResearch(); id = localStorage.getItem("pyro-last-research-v1"); }
  if(!id)return null;
  try {return (await getBundle(id)).result;}
  catch(error) {
    if(!(error instanceof ResearchApiError)||error.code!=="INVALID_RESPONSE")throw error;
    await recoverLocalResearch();
    const repaired=localStorage.getItem("pyro-last-research-v1");
    return repaired&&repaired!==id?(await getBundle(repaired)).result:null;
  }
}

// Rebuild only secondary indexes; persisted bundles/reports are never rewritten.
export async function recoverLocalResearch() {
  // Older on-demand checkpoints have no record marker; their resume pointers
  // identify them without rewriting or deleting any persisted bundle.
  const checkpointIds = new Set<string>();
  for (let index=0; index<localStorage.length; index++) {
    const key=localStorage.key(index);
    if(key?.startsWith("pyro-stage-v1-")) {
      const id=localStorage.getItem(key);
      if(id)checkpointIds.add(id);
    }
  }
  const db=await database();
  const summaries: {id:string;name:string;start:string;end:string}[]=[];
  let invalid=0;
  try {
    await new Promise<void>((resolve,reject)=>{
      const tx=db.transaction("results");
      const cursor=tx.objectStore("results").openCursor();
      cursor.onsuccess=()=>{
        const item=cursor.result;
        if(!item)return;
        if(item.value?.localStageOnly===true||checkpointIds.has(item.value?.result?.id)){item.continue();return;}
        const parsed=bundleSchema.safeParse(item.value);
        if(parsed.success){const r=parsed.data.result;summaries.push({id:r.id,name:r.area.name,start:r.primary.period.start,end:r.primary.period.end});}
        else invalid++;
        item.continue();
      };
      tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(new ResearchApiError("STORAGE_UNAVAILABLE"));
    });
  } finally {db.close();}
  const raw=localStorage.getItem(historyKey);
  let history:ReturnType<typeof researchHistory>=[];
  try {history=researchHistory();}catch {
    // Keep damaged text verbatim for manual export; never erase it during repair.
    const backupKey=`${historyKey}-recovery-backup`;
    if(raw!==null&&localStorage.getItem(backupKey)!==raw) {
      if(localStorage.getItem(backupKey)!==null)throw new ResearchApiError("STORAGE_UNAVAILABLE");
      localStorage.setItem(backupKey,raw);
    }
  }
  const merged=new Map(history.map(row=>[row.id,row]));
  for(const summary of summaries.sort((a,b)=>a.id.localeCompare(b.id)))merged.set(summary.id,summary);
  localStorage.setItem(historyKey,JSON.stringify([...merged.values()]));
  const old=localStorage.getItem("pyro-last-research-v1");
  if(summaries.length&&!summaries.some(row=>row.id===old)) {
    if(old) {
      const key="pyro-last-research-v1-recovery-backup";
      if(localStorage.getItem(key)===null)localStorage.setItem(key,old);
      else if(localStorage.getItem(key)!==old)localStorage.setItem(`${key}:${encodeURIComponent(old)}`,old);
    }
    localStorage.setItem("pyro-last-research-v1",summaries[0].id);
  }
  return {valid:summaries.length,invalidRetained:invalid};
}
const historySchema = z.array(z.object({ id: z.string(), name: z.string(), start: z.string(), end: z.string() }).strict());
export function researchHistory() {
  return historySchema.parse(JSON.parse(localStorage.getItem(historyKey) || "[]"));
}
export async function openResearchResult(id: string) {
  const result = (await getBundle(id)).result;
  localStorage.setItem("pyro-last-research-v1", id);
  if (typeof window !== "undefined") window.dispatchEvent(new Event("pyro-research-updated"));
  if (typeof window !== "undefined") window.dispatchEvent(new Event("pyro-research-selected"));
  return result;
}
