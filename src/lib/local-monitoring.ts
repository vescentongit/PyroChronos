import { z } from "zod";
import { researchAnalysisResultSchema, researchDetectionsPageSchema } from "./research-contracts.ts";
import type { ResearchAnalysisResult } from "./research-contracts";

export const detectionSchema = researchDetectionsPageSchema.shape.observations.element;
export type Detection = z.infer<typeof detectionSchema>;
const text = z.string().trim().min(1).max(200);
const instant = z.iso.datetime({ offset: true });
export const inspectionInput = z.object({
  inspector: text, recorder: text, observedAt: instant,
  outcome: z.enum(["fire_or_smoke_found", "no_sign_at_inspection", "inconclusive"]),
  notes: z.string().max(2000),
});
const reportSchema = inspectionInput.extend({
  id: z.string(), requestId: z.string(), createdAt: instant, revision: z.number().int().positive(),
  corrections: z.array(z.object({ previous: inspectionInput, revision: z.number().int(), reason: text, correctedAt: instant, correctedBy: text })),
});
const assignmentSchema = z.object({
  id: z.string(), requestId: z.string(), assignee: text, recorder: text, createdAt: instant,
  status: z.enum(["assigned", "in_progress", "completed", "cancelled"]),
  history: z.array(z.object({ from: z.string(), to: z.string(), actor: text, at: instant })),
  reports: z.array(reportSchema),
});
export const localLocationSchema = z.object({
  id: z.string(), revision: z.number().int().positive(), name: text, creator: text, createdAt: instant,
  initialAnalysis: researchAnalysisResultSchema, anchor: detectionSchema,
  assignments: z.array(assignmentSchema),
  operations: z.array(z.object({ requestId: z.string(), payload: z.string() })),
});
export type LocalLocation = z.infer<typeof localLocationSchema>;
export type InspectionInput = z.infer<typeof inspectionInput>;
export type MonitoringAction =
  | { kind: "assign"; assignee: string; recorder: string }
  | { kind: "status"; assignmentId: string; status: "in_progress" | "completed" | "cancelled"; actor: string }
  | { kind: "report"; assignmentId: string; report: InspectionInput }
  | { kind: "correct"; assignmentId: string; reportId: string; report: InspectionInput; reason: string };

export function newLocation(result: ResearchAnalysisResult, observation: Detection, name: string, creator: string): LocalLocation {
  const parsed = researchAnalysisResultSchema.parse(result);
  const anchor = detectionSchema.parse(observation);
  // Membership in the immutable result is checked by the caller against its detection pages.
  return localLocationSchema.parse({ id: crypto.randomUUID(), revision: 1, name, creator, createdAt: new Date().toISOString(), initialAnalysis: parsed, anchor, assignments: [], operations: [] });
}

export function changeLocation(value: LocalLocation, expectedRevision: number, requestId: string, action: MonitoringAction, now = new Date().toISOString()): LocalLocation {
  const location = localLocationSchema.parse(structuredClone(value));
  const payload = JSON.stringify(action);
  const previous = location.operations.find(op => op.requestId === requestId);
  if (previous) {
    if (previous.payload !== payload) throw new Error("IDEMPOTENCY_CONFLICT");
    return location;
  }
  if (location.revision !== expectedRevision) throw new Error("REVISION_CONFLICT");
  if (action.kind === "assign") {
    location.assignments.push({ id: requestId, requestId, assignee: text.parse(action.assignee), recorder: text.parse(action.recorder), createdAt: now, status: "assigned", history: [], reports: [] });
  } else {
    const assignment = location.assignments.find(item => item.id === action.assignmentId);
    if (!assignment) throw new Error("NOT_FOUND");
    if (action.kind === "status") {
      text.parse(action.actor);
      if (["completed", "cancelled"].includes(assignment.status) || (action.status === "in_progress" && assignment.status !== "assigned")) throw new Error("INVALID_TRANSITION");
      if (action.status === "completed" && !assignment.reports.length) throw new Error("REPORT_REQUIRED");
      assignment.history.push({ from: assignment.status, to: action.status, actor: action.actor, at: now });
      assignment.status = action.status;
    } else {
      const input = inspectionInput.parse(action.report);
      if (Date.parse(input.observedAt) > Date.parse(now)) throw new Error("FUTURE_INSPECTION");
      if (action.kind === "report") {
        if (["completed", "cancelled"].includes(assignment.status)) throw new Error("INVALID_TRANSITION");
        assignment.reports.push({ ...input, id: requestId, requestId, createdAt: now, revision: 1, corrections: [] });
      } else {
        const report = assignment.reports.find(item => item.id === action.reportId);
        if (!report) throw new Error("NOT_FOUND");
        const { inspector, recorder, observedAt, outcome, notes } = report;
        report.corrections.push({ previous: { inspector, recorder, observedAt, outcome, notes }, revision: report.revision, reason: text.parse(action.reason), correctedAt: now, correctedBy: input.recorder });
        Object.assign(report, input, { recorder, revision: report.revision + 1 });
      }
    }
  }
  location.operations.push({ requestId, payload });
  location.revision++;
  return localLocationSchema.parse(location);
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("pyro-monitoring-v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("locations", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = request.onblocked = () => reject(new Error("STORAGE_UNAVAILABLE"));
  });
}
export async function listLocations(): Promise<LocalLocation[]> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("locations").objectStore("locations").getAll();
      request.onsuccess = () => { try { resolve(z.array(localLocationSchema).parse(request.result)); } catch { reject(new Error("STORAGE_UNAVAILABLE")); } };
      request.onerror = () => reject(new Error("STORAGE_UNAVAILABLE"));
    });
  } finally { db.close(); }
}

// One transaction serializes cross-tab writes and checks the revision before overwriting.
export async function saveLocation(value: LocalLocation, operation?: { requestId: string; action: MonitoringAction }): Promise<LocalLocation> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("locations", "readwrite");
      const store = tx.objectStore("locations");
      let saved = value;
      let failure = "STORAGE_UNAVAILABLE";
      const request = store.getAll();
      request.onsuccess = () => {
        try {
          const rows = z.array(localLocationSchema).parse(request.result);
          if (operation) {
            const current = rows.find(row => row.id === value.id);
            if (!current) throw new Error("NOT_FOUND");
            saved = changeLocation(current, value.revision, operation.requestId, operation.action);
          } else {
            saved = rows.find(row => row.initialAnalysis.id === value.initialAnalysis.id && row.initialAnalysis.mode === value.initialAnalysis.mode && row.anchor.id === value.anchor.id) ?? localLocationSchema.parse(value);
          }
          store.put(saved);
        } catch (error) { failure = error instanceof Error ? error.message : failure; tx.abort(); }
      };
      tx.oncomplete = () => resolve(saved);
      tx.onerror = tx.onabort = () => reject(new Error(failure));
    });
  } finally { db.close(); }
}
