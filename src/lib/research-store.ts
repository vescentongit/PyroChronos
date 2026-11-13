import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { researchAnalysisResultSchema, researchDailyPageSchema, researchDetectionsPageSchema, researchJobSchema } from "./research-contracts.ts";
import { containsPoint, validateResearchGeometry } from "./research-server-geometry.ts";

export type Row = Record<string, any>;
export interface Sql {
  query(sql: string, params?: unknown[]): Promise<Row[]>;
  transaction<T>(fn: (db: Sql) => Promise<T>): Promise<T>;
}
export const hash = (value: unknown): string => {
  const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map(key => [key, canonical(v[key])])) : v;
  return "sha256:" + createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
};
export class ResearchFailure extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 400) { super(code); this.code = code; this.status = status; }
}
export const fail = (code: string, status = 400): never => { throw new ResearchFailure(code, status); };
export const iso = (value: any) => value == null ? null : new Date(value).toISOString();
export const errorPayload = (code: string, requestId: string | null = null) => ({
  schemaVersion: "research-2", error: code.replaceAll("_", " "), code,
  retryable: ["RATE_LIMITED", "CAPACITY_LIMIT", "DEPENDENCY_UNAVAILABLE"].includes(code), requestId,
});
const json = JSON.stringify;
export async function member(db: Sql, workspace: string, user: string, owner = false) {
  const [row] = await db.query('SELECT * FROM "Membership" WHERE "workspaceId"=$1 AND "userId"=$2 AND active=true', [workspace, user]);
  if (!row || (owner && row.role !== "owner")) fail("FORBIDDEN", 403);
  return row;
}
export async function workspaceLock(db: Sql, workspace: string) {
  await db.query('SELECT id FROM "Workspace" WHERE id=$1 FOR UPDATE', [workspace]);
}
export async function idempotent(db: Sql, scope: string, requestId: string, body: unknown, action: () => Promise<{ value: any; status: number }>) {
  // Serialize even the first request, before a request record exists.
  await db.query("SELECT pg_advisory_xact_lock(hashtext($1))::text", [scope]);
  const [old] = await db.query('SELECT * FROM "ResearchRequest" WHERE scope=$1 AND "requestId"=$2', [scope, requestId]);
  const digest = hash(body);
  if (old) {
    if (old.payloadHash !== digest) fail("IDEMPOTENCY_CONFLICT", 409);
    return { value: old.response, status: old.statusCode };
  }
  const [{ count }] = await db.query('SELECT count(*)::int AS count FROM "ResearchRequest" WHERE scope=$1 AND "createdAt">CURRENT_TIMESTAMP-INTERVAL \'1 minute\'', [scope]);
  if (count >= 30) fail("RATE_LIMITED", 429);
  const response = await action();
  await db.query('INSERT INTO "ResearchRequest" (scope,"requestId","payloadHash",response,"statusCode") VALUES ($1,$2,$3,$4::jsonb,$5)', [scope, requestId, digest, json(response.value), response.status]);
  return response;
}
export const areaWire = (row: Row) => ({ schemaVersion: "research-2", id: row.id, workspaceId: row.workspaceId, revision: row.revision, name: row.name, geometry: row.geometry, geometryHash: row.geometryHash, areaKm2: row.areaKm2, createdAt: iso(row.createdAt) });
export const workspaceWire = (row: Row) => ({ schemaVersion: "research-2", id: row.id, name: row.name, createdAt: iso(row.createdAt), createdBy: { id: row.createdById, displayName: row.creatorName ?? null } });
export const membershipWire = (row: Row) => ({ schemaVersion: "research-2", workspaceId: row.workspaceId, user: { id: row.userId, displayName: row.name ?? null }, role: row.role, active: row.active, revision: row.revision });
export async function getArea(db: Sql, workspace: string, id: string) {
  const [area] = await db.query('SELECT * FROM "AnalysisArea" WHERE "workspaceId"=$1 AND id=$2', [workspace, id]);
  if (!area) fail("NOT_FOUND", 404);
  return areaWire(area);
}
export async function createArea(db: Sql, workspace: string, body: Row) {
  let geometry;
  try { geometry = validateResearchGeometry(body.geometry); } catch { return fail("INVALID_REQUEST"); }
  const [row] = await db.query('INSERT INTO "AnalysisArea" (id,"workspaceId",name,geometry,"geometryHash","areaKm2") VALUES ($1,$2,$3,$4::jsonb,$5,$6) RETURNING *', [randomUUID(), workspace, body.name, json(geometry.geometry), geometry.geometryHash, geometry.areaKm2]);
  return areaWire(row);
}
export async function getJobRow(db: Sql, workspace: string, id: string) {
  const [row] = await db.query('SELECT j.*, r.status,r."analysisKey",r."startedAt",r."completedAt",r.error,r.input,r."datasetId" FROM "AnalysisJob" j JOIN "AnalysisRun" r ON r.id=j."runId" WHERE j."workspaceId"=$1 AND j.id=$2', [workspace, id]);
  if (!row) fail("NOT_FOUND", 404);
  return row;
}
export function jobWire(row: Row) {
  return researchJobSchema.parse({ schemaVersion: "research-2", id: row.id, workspaceId: row.workspaceId, requestId: row.requestId, analysisKey: row.analysisKey, areaId: row.areaId, areaRevision: row.input.area.revision, status: row.status, stage: row.status === "running" ? "aggregate" : null, progressPercent: null,
    // A reused computation can predate this submission; expose its lifecycle consistently.
    createdAt: iso(row.input.createdAt), startedAt: iso(row.startedAt), completedAt: iso(row.completedAt), resultId: row.status === "succeeded" ? row.id : null, error: row.error });
}
export { submitP1Analysis as submitAnalysis } from "./research-analysis-submissions.ts";
export async function submitLegacyAnalysis(db: Sql, workspace: string, user: string, body: Row) {
  const today = new Date().toISOString().slice(0, 10);
  if ([body.period, body.comparisonPeriod].filter(Boolean).some(p => p.end > today) || body.baseline.windowYears > 30 || body.monitoringLocationId !== null) fail("INVALID_REQUEST");
  const area = await getArea(db, workspace, body.areaId);
  if (area.revision !== body.areaRevision) fail("REVISION_CONFLICT", 409);
  const [dataset] = await db.query('SELECT * FROM "ResearchDataset" ORDER BY "createdAt" DESC,id DESC LIMIT 1');
  if (!dataset) fail("DEPENDENCY_UNAVAILABLE", 503);
  if (body.qualityPolicyVersion !== dataset.config.qualityPolicyVersion) fail("INVALID_REQUEST");
  const { requestId: _requestId, ...settings } = body;
  const analysisKey = hash({ settings, geometryHash: area.geometryHash, datasetId: dataset.id, configuration: dataset.config });
  let [run] = await db.query('SELECT * FROM "AnalysisRun" WHERE "workspaceId"=$1 AND "analysisKey"=$2 AND status<>\'failed\' ORDER BY "createdAt" DESC LIMIT 1', [workspace, analysisKey]);
  if (!run) {
    const [{ count }] = await db.query('SELECT count(*)::int AS count FROM "AnalysisRun" WHERE "workspaceId"=$1 AND status IN (\'queued\',\'running\')', [workspace]);
    if (count >= 5) fail("CAPACITY_LIMIT", 503);
    const input = { ...settings, area, dataset: dataset.config, createdAt: new Date().toISOString() };
    [run] = await db.query('INSERT INTO "AnalysisRun" (id,"workspaceId","analysisKey","datasetId",input) VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING *', [randomUUID(), workspace, analysisKey, dataset.id, json(input)]);
  }
  const id = randomUUID();
  await db.query('INSERT INTO "AnalysisJob" (id,"workspaceId","areaId","actorId","requestId","runId") VALUES ($1,$2,$3,$4,$5,$6)', [id, workspace, area.id, user, body.requestId, run.id]);
  return jobWire(await getJobRow(db, workspace, id));
}
export async function getArtifact(db: Sql, workspace: string, id: string) {
  const job = await getJobRow(db, workspace, id);
  if (job.status !== "succeeded") fail("RESULT_NOT_READY", 409);
  const [artifact] = await db.query('SELECT * FROM "AnalysisArtifact" WHERE "runId"=$1', [job.runId]);
  if (!artifact) fail("DEPENDENCY_UNAVAILABLE", 503);
  return { job, artifact };
}
export function resultWire(job: Row, artifact: Row) {
  return researchAnalysisResultSchema.parse({ ...artifact.result, id: job.id, jobId: job.id });
}
export function cursorRead(cursor: string | null, scope: string): string | number | null {
  if (!cursor) return null;
  try {
    if (cursor.length > 2048) throw new Error();
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString());
    if (value.scope !== scope || !(typeof value.after === "string" || Number.isSafeInteger(value.after))) throw new Error();
    return value.after;
  } catch { return fail("INVALID_REQUEST"); }
}
export const cursorWrite = (scope: string, after: string | number) => Buffer.from(json({ scope, after })).toString("base64url");
export function rolePeriod(result: Row, role: string) {
  if (!["primary", "comparison"].includes(role) || !result[role]) fail("INVALID_REQUEST");
  return result[role].period;
}
export async function claimRun(db: Sql) {
  return db.transaction(async tx => {
    const [run] = await tx.query('SELECT * FROM "AnalysisRun" WHERE status=\'queued\' OR (status=\'running\' AND "leaseUntil"<CURRENT_TIMESTAMP) ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1');
    if (!run) return null;
    if (run.status === "running") await tx.query('UPDATE "AnalysisAttempt" SET "completedAt"=CURRENT_TIMESTAMP,error=\'LEASE_EXPIRED\' WHERE "runId"=$1 AND "completedAt" IS NULL', [run.id]);
    if (run.attempts >= 3) {
      await tx.query('UPDATE "AnalysisRun" SET status=\'failed\',"completedAt"=CURRENT_TIMESTAMP,"leaseToken"=NULL,"leaseUntil"=NULL,error=$2::jsonb WHERE id=$1', [run.id, json(errorPayload("DEPENDENCY_UNAVAILABLE"))]);
      return null;
    }
    const token = randomUUID();
    const [claimed] = await tx.query('UPDATE "AnalysisRun" SET status=\'running\',attempts=attempts+1,"startedAt"=COALESCE("startedAt",CURRENT_TIMESTAMP),"leaseToken"=$2,"leaseUntil"=CURRENT_TIMESTAMP+INTERVAL \'120 seconds\' WHERE id=$1 RETURNING *', [run.id, token]);
    await tx.query('INSERT INTO "AnalysisAttempt" ("runId",attempt,token) VALUES ($1,$2,$3)', [run.id, claimed.attempts, token]);
    return claimed;
  });
}
export async function heartbeat(db: Sql, id: string, token: string) {
  const rows = await db.query('UPDATE "AnalysisRun" SET "leaseUntil"=clock_timestamp()+INTERVAL \'120 seconds\' WHERE id=$1 AND "leaseToken"=$2 AND status=\'running\' AND "leaseUntil">clock_timestamp() RETURNING id', [id, token]);
  return rows.length === 1;
}
export async function failRun(db: Sql, run: Row, code = "DEPENDENCY_UNAVAILABLE") {
  await db.transaction(async tx => {
    const rows = await tx.query('UPDATE "AnalysisRun" SET status=\'failed\',"completedAt"=clock_timestamp(),error=$3::jsonb,"leaseToken"=NULL,"leaseUntil"=NULL WHERE id=$1 AND "leaseToken"=$2 AND status=\'running\' AND "leaseUntil">clock_timestamp() RETURNING id', [run.id, run.leaseToken, json(errorPayload(code))]);
    if (rows.length) await tx.query('UPDATE "AnalysisAttempt" SET "completedAt"=CURRENT_TIMESTAMP,error=$3 WHERE "runId"=$1 AND token=$2', [run.id, run.leaseToken, code]);
  });
}
export const producerBundleSchema = z.object({ result: researchAnalysisResultSchema, manifest: z.record(z.string(), z.unknown()), days: z.array(researchDailyPageSchema), detections: z.array(researchDetectionsPageSchema) }).strict();
export function validateProducerBundle(run: Row, raw: unknown) {
  const bundle = producerBundleSchema.parse(raw), result = bundle.result;
  const input = run.input;
  if (result.id !== run.id || result.jobId !== run.id || result.workspaceId !== run.workspaceId || hash(result.area) !== hash(input.area) || hash(result.primary.period) !== hash(input.period) || hash(result.comparison?.period ?? null) !== hash(input.comparisonPeriod) || result.baseline.windowYears !== input.baseline.windowYears || result.qualityPolicyVersion !== input.qualityPolicyVersion || result.method.manifestId !== bundle.manifest.id || result.mode !== "research") throw new Error("INVALID_PRODUCER");
  const roles = input.comparisonPeriod ? ["primary", "comparison"] : ["primary"];
  for (const role of roles) {
    const period = rolePeriod(result, role), dates = new Set<string>(), seen = new Set<string>();
    const pages = bundle.days.filter(page => page.periodRole === role);
    for (const page of pages) {
      if (page.analysisId !== run.id || page.nextCursor !== null) throw new Error("INVALID_DAYS");
      for (const day of page.days) {
        if (day.date < period.start || day.date > period.end || dates.has(day.date)) throw new Error("INVALID_DAYS");
        dates.add(day.date);
      }
    }
    if (dates.size !== (Date.parse(period.end) - Date.parse(period.start)) / 86400000 + 1) throw new Error("INCOMPLETE_DAYS");
    const observations = bundle.detections.filter(page => page.periodRole === role).flatMap(page => {
      if (page.analysisId !== run.id) throw new Error("INVALID_DETECTIONS");
      return page.observations;
    });
    const perSource: Record<string, number> = {};
    for (const observation of observations) {
      const day = observation.observedAt.slice(0, 10);
      if (day < period.start || day > period.end || seen.has(observation.id) || !containsPoint(input.area.geometry, observation.coordinates) || !result.sources.some(source => source.id === observation.sourceId)) throw new Error("INVALID_DETECTIONS");
      seen.add(observation.id);
      perSource[observation.sourceId] = (perSource[observation.sourceId] ?? 0) + 1;
    }
    const summary = role === "primary" ? result.primary : result.comparison!;
    if (observations.length !== (summary.metric.rawCount ?? 0) || Object.entries(summary.metric.rawCountsBySource).some(([source, count]) => count !== null && count !== (perSource[source] ?? 0))) throw new Error("INCOMPLETE_DETECTIONS");
  }
  if ([...bundle.days, ...bundle.detections].some(page => !roles.includes(page.periodRole))) throw new Error("INVALID_PERIOD_ROLE");
  if (bundle.detections.reduce((sum, page) => sum + page.observations.length, 0) > 100000) throw new ResearchFailure("CAPACITY_LIMIT", 503);
  return bundle;
}
export async function publishRun(db: Sql, run: Row, raw: unknown) {
  const bundle = validateProducerBundle(run, raw), result = bundle.result;
  const roles = run.input.comparisonPeriod ? ["primary", "comparison"] : ["primary"];
  return db.transaction(async tx => {
    const [current] = await tx.query('SELECT * FROM "AnalysisRun" WHERE id=$1 AND "leaseToken"=$2 AND status=\'running\' AND "leaseUntil">clock_timestamp() FOR UPDATE', [run.id, run.leaseToken]);
    if (!current) throw new Error("LEASE_LOST");
    const published = { ...result, publishedAt: new Date().toISOString() };
    await tx.query('INSERT INTO "AnalysisArtifact" ("runId",result,manifest,days) VALUES ($1,$2::jsonb,$3::jsonb,$4::jsonb)', [run.id, json(published), json(bundle.manifest), json(bundle.days)]);
    for (const role of roles) {
      const observations = bundle.detections.filter(page => page.periodRole === role).flatMap(page => page.observations).sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.id.localeCompare(b.id));
      for (let start = 0; start < observations.length; start += 1000) {
        const rows = observations.slice(start, start + 1000).map((payload, i) => ({ ordinal: start + i, longitude: payload.coordinates[0], latitude: payload.coordinates[1], payload }));
        await tx.query('INSERT INTO "ResearchObservation" ("runId","periodRole",ordinal,longitude,latitude,payload) SELECT $1,$2,ordinal,longitude,latitude,payload FROM jsonb_to_recordset($3::jsonb) AS x(ordinal int,longitude double precision,latitude double precision,payload jsonb)', [run.id, role, json(rows)]);
      }
    }
    const completed = await tx.query('UPDATE "AnalysisRun" SET status=\'succeeded\',"completedAt"=clock_timestamp(),"leaseToken"=NULL,"leaseUntil"=NULL WHERE id=$1 AND "leaseToken"=$2 AND status=\'running\' AND "leaseUntil">clock_timestamp() RETURNING id', [run.id, run.leaseToken]);
    if (!completed.length) throw new Error("LEASE_LOST");
    await tx.query('UPDATE "AnalysisAttempt" SET "completedAt"=CURRENT_TIMESTAMP WHERE "runId"=$1 AND token=$2', [run.id, run.leaseToken]);
  });
}
