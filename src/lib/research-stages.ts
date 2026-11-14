import { z } from "zod";
import { researchAnalysisResultSchema, researchAreaSchema, researchDailyPageSchema, researchDetectionsPageSchema, type ResearchAnalysisRequest } from "./research-contracts";

export const localBundleSchema = z.object({ result: researchAnalysisResultSchema, manifest: z.record(z.string(), z.unknown()), days: z.array(researchDailyPageSchema), detections: z.array(researchDetectionsPageSchema) }).strict();
export type LocalBundle = z.infer<typeof localBundleSchema>;
type Period = ResearchAnalysisRequest["period"];
export type ResearchStage = { role: "primary" | "comparison"; period: Period };
export type StageProgress = { stage: ResearchStage; status: "pending" | "loading" | "saved" | "failed"; metric?: LocalBundle["result"]["primary"]["metric"] };

export function researchStages(body: Pick<ResearchAnalysisRequest, "period" | "comparisonPeriod">): ResearchStage[] {
  const stages: ResearchStage[] = [];
  for (const role of ["primary", "comparison"] as const) {
    const period = role === "primary" ? body.period : body.comparisonPeriod;
    if (!period) continue;
    let first = period.start;
    while (first <= period.end) {
      const next = new Date(`${first.slice(0, 7)}-01T00:00:00Z`);
      next.setUTCMonth(next.getUTCMonth() + 1);
      const last = new Date(next.getTime() - 86400000).toISOString().slice(0, 10);
      stages.push({ role, period: { start: first, end: last < period.end ? last : period.end } });
      first = next.toISOString().slice(0, 10);
    }
  }
  return stages;
}

export async function contentHash(value: unknown) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, "0")).join("");
}

export async function combineResearchStages(area: z.infer<typeof researchAreaSchema>, body: ResearchAnalysisRequest, stages: { stage: ResearchStage; bundle: LocalBundle }[]): Promise<LocalBundle> {
  const expected = researchStages(body);
  if (!stages.length || JSON.stringify(stages.map(item => item.stage)) !== JSON.stringify(expected)) throw new Error("INVALID_RESPONSE");
  const first = stages[0].bundle.result;
  const method = ({ manifestId: _id, ...rest }: typeof first.method) => rest;
  for (const { stage, bundle } of stages) {
    const result = bundle.result;
    if (result.workspaceId !== area.workspaceId || result.area.geometryHash !== area.geometryHash || JSON.stringify(result.area.geometry) !== JSON.stringify(area.geometry) || result.comparison !== null || JSON.stringify(result.primary.period) !== JSON.stringify(stage.period) || result.baseline.windowYears !== body.baseline.windowYears || result.qualityPolicyVersion !== body.qualityPolicyVersion || JSON.stringify(result.baseline) !== JSON.stringify(first.baseline) || JSON.stringify(method(result.method)) !== JSON.stringify(method(first.method))) throw new Error("INVALID_RESPONSE");
  }
  const provenance = stages.map(({ stage, bundle }) => ({ ...stage, analysisId: bundle.result.id, dataVersion: bundle.result.dataVersion, manifest: bundle.manifest }));
  const checksum = await contentHash({ geometry: area.geometry, periods: expected, stages: provenance });
  const id = `staged-${await contentHash({ checksum, areaId: area.id })}`;
  const manifestId = `manifest-${checksum}`;
  const aggregate = (role: ResearchStage["role"], period: Period) => {
    const metrics = stages.filter(item => item.stage.role === role).map(item => item.bundle.result.primary.metric);
    const rawCountsBySource = Object.fromEntries(first.sources.map(source => {
      const values = metrics.map(metric => metric.rawCountsBySource[source.id]);
      return [source.id, values.every(value => value == null) ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0)];
    }));
    const known = Object.values(rawCountsBySource).filter((value): value is number => value !== null);
    const harmonizedCount = metrics.every(metric => metric.harmonizedCount !== null) ? Math.round(metrics.reduce((sum, metric) => sum + metric.harmonizedCount!, 0) * 1e6) / 1e6 : null;
    const status = !known.length ? "no_data" : harmonizedCount !== null ? "available" : metrics.every(metric => metric.status === "method_unsupported") ? "method_unsupported" : "partial";
    return { period, days: (Date.parse(period.end) - Date.parse(period.start)) / 86400000 + 1, metric: { rawCount: known.length ? known.reduce((sum, value) => sum + value, 0) : null, rawCountsBySource, harmonizedCount, status } };
  };
  const sources = await Promise.all(first.sources.map(async source => {
    const parts = stages.map(item => item.bundle.result.sources.find(part => part.id === source.id)!);
    if (parts.some(part => !part)) throw new Error("INVALID_RESPONSE");
    const from = parts.flatMap(part => part.observedFrom ? [part.observedFrom] : []).sort();
    const to = parts.flatMap(part => part.observedTo ? [part.observedTo] : []).sort();
    return { ...source, status: parts.every(part => part.status === "available") ? "available" : parts.every(part => part.status === "unavailable") ? "unavailable" : "partial", observedFrom: from[0] ?? null, observedTo: to.at(-1) ?? null, checksum: `sha256:${await contentHash(parts.map(part => part.checksum))}` };
  }));
  const result = researchAnalysisResultSchema.parse({ ...first, id, jobId: id, area,
    primary: aggregate("primary", body.period), comparison: body.comparisonPeriod ? aggregate("comparison", body.comparisonPeriod) : null,
    method: { ...first.method, manifestId }, sources, dataVersion: `firms-staged-${checksum}`,
    generatedAt: stages.map(item => item.bundle.result.generatedAt).sort()[0], publishedAt: new Date().toISOString(),
    months: stages.filter(item => item.stage.role === "primary").flatMap(item => item.bundle.result.months),
  });
  const days = stages.flatMap(({ stage, bundle }) => bundle.days.map(page => ({ ...page, analysisId: id, periodRole: stage.role })));
  const detections = stages.flatMap(({ stage, bundle }) => bundle.detections.map(page => ({ ...page, analysisId: id, periodRole: stage.role, nextCursor: null })));
  return localBundleSchema.parse({ result, manifest: { schema: "research-staged-manifest-1", id: manifestId, contentSha256: checksum, stages: provenance }, days, detections });
}
