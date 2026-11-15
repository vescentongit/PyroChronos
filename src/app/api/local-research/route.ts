import { randomUUID } from "node:crypto";
import { researchProducer as producer, maxHostedBundleBytes, producerFailureCodes } from "@/lib/research-producer";
import { z } from "zod";
import { createResearchAnalysisSchema, createResearchAreaSchema, researchAreaSchema } from "@/lib/research-contracts";
import { validateResearchGeometry } from "@/lib/research-server-geometry";
import { validateProducerBundle } from "@/lib/research-store";

export const runtime = "nodejs";
export const maxDuration = 300;
const areaInput = z.object({ action: z.literal("area"), workspaceId: z.string().min(1).max(200), area: createResearchAreaSchema }).strict();
const analysisInput = z.object({ action: z.literal("analyze"), workspaceId: z.string().min(1).max(200), area: researchAreaSchema, request: createResearchAnalysisSchema, includeBaseline: z.boolean().default(true) }).strict();
const answerSchema = z.object({ fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/), bundle: z.unknown() }).strict();
let running = false;

export async function POST(req: Request) {
  const error = (code: string, status: number) => Response.json({ code }, { status, headers: { "Cache-Control": "no-store" } });
  if (Number(req.headers.get("content-length") || 0) > 100_000) return error("INVALID_REQUEST", 400);
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return error("INVALID_REQUEST", 400);
  const origin = req.headers.get("origin"), host = req.headers.get("host");
  if (origin) {
    try { if (!host || new URL(origin).origin !== `${new URL(req.url).protocol}//${host}`) return error("FORBIDDEN", 403); }
    catch { return error("FORBIDDEN", 403); }
  }
  let raw: unknown;
  try {
    if (!req.body) return error("INVALID_REQUEST", 400);
    const reader = req.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 100_000) { await reader.cancel(); return error("INVALID_REQUEST", 400); }
      chunks.push(part.value);
    }
    raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return error("INVALID_REQUEST", 400); }
  const area = areaInput.safeParse(raw);
  if (area.success) {
    try {
      const geometry = validateResearchGeometry(area.data.area.geometry);
      return Response.json({ schemaVersion: "research-2", id: randomUUID(), workspaceId: area.data.workspaceId, revision: 1, name: area.data.area.name, ...geometry, createdAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
    } catch { return error("INVALID_REQUEST", 400); }
  }
  const input = analysisInput.safeParse(raw);
  if (!input.success) return error("INVALID_REQUEST", 400);
  const { request, workspaceId } = input.data;
  const submittedArea = input.data.area;
  try {
    const geometry = validateResearchGeometry(submittedArea.geometry);
    if (geometry.geometryHash !== submittedArea.geometryHash || submittedArea.id !== request.areaId || submittedArea.workspaceId !== workspaceId || submittedArea.revision !== request.areaRevision || request.monitoringLocationId !== null || request.baseline.windowYears > 30 || request.qualityPolicyVersion !== "quality-policy-1" || [request.period, request.comparisonPeriod].filter(Boolean).some(period => period!.end > new Date().toISOString().slice(0, 10))) return error("INVALID_REQUEST", 400);
  } catch { return error("INVALID_REQUEST", 400); }
  const root = process.env.RESEARCH_DATA_DIR;
  if (!root && !process.env.PIPELINE_URL && !process.env.FIRMS_MAP_KEY) { console.warn("[local-research] producer not configured"); return error("NOT_CONFIGURED", 503); }
  if (running) return error("CAPACITY_LIMIT", 503);
  running = true;
  let stage = "producer";
  try {
    const run = { id: randomUUID(), workspaceId, input: { ...request, includeBaseline: input.data.includeBaseline, area: submittedArea, dataset: { sources: ["MODIS_SP", "VIIRS_SNPP_SP"], qualityPolicyVersion: "quality-policy-1", producerVersion: "research-harmonized-1" } } };
    const answer = answerSchema.parse(await producer({ action: "analyze", root, run }, req.signal));
    stage = "validation";
    const bundle = validateProducerBundle({ ...run, input: { ...run.input, dataset: { ...run.input.dataset, fingerprint: answer.fingerprint } } }, answer.bundle);
    if (bundle.manifest.snapshot && bundle.result.dataVersion !== `firms-area-${answer.fingerprint.slice(7)}`) throw new Error("INVALID_PRODUCER");
    if (process.env.PIPELINE_URL && Buffer.byteLength(JSON.stringify(bundle)) > maxHostedBundleBytes) return error("CAPACITY_LIMIT", 503);
    return Response.json(bundle, { headers: { "Cache-Control": "private, no-store" } });
  } catch (reason) {
    const known = reason instanceof Error && ["INVALID_PRODUCER", "INVALID_DAYS", "INCOMPLETE_DAYS", "INVALID_DETECTIONS", "INCOMPLETE_DETECTIONS", "INVALID_PERIOD_ROLE", ...producerFailureCodes].includes(reason.message) ? reason.message : "UNAVAILABLE";
    console.warn(`[local-research] ${stage} ${known}`);
    return error(producerFailureCodes.includes(known) ? known : "DEPENDENCY_UNAVAILABLE", known === "RATE_LIMITED" ? 429 : 503);
  }
  finally { running = false; }
}
