import type { ResearchAnalysisResult } from "./research-contracts";
import type { Detection } from "./local-monitoring";

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const string = typeof value === "string" && /^[\s]*[=+\-@\t\r]/.test(value) ? `'${value}` : String(value);
  return `"${string.replaceAll('"', '""')}"`;
}
const csv = (rows: unknown[][]) => rows.map(row => row.map(csvCell).join(",")).join("\r\n");
function context(result: ResearchAnalysisResult, role: "primary" | "comparison") {
  const period = role === "primary" ? result.primary : result.comparison;
  if (!period) throw new Error("INVALID_REQUEST");
  return [result.mode, result.id, result.area.name, result.area.geometryHash, result.area.revision, role, period.period.start, period.period.end, period.days, result.dataVersion, result.method.name, result.method.version, result.method.validation, result.method.unit, result.baseline.windowYears, result.baseline.policyVersion, JSON.stringify(result.sources)];
}
const headers = ["mode", "analysisId", "area", "geometryHash", "areaRevision", "periodRole", "startUTC", "endUTC", "days", "dataVersion", "method", "methodVersion", "validation", "estimateUnit", "baselineWindowYears", "baselinePolicy", "sources"];
export function rawResearchCsv(result: ResearchAnalysisResult, points: Detection[], role: "primary" | "comparison" = "primary") {
  const metadata = context(result, role);
  const period = role === "primary" ? result.primary : result.comparison!;
  return csv([["recordType", ...headers, "periodStatus", "id", "sourceId", "observedAtUTC", "longitude", "latitude", "confidence", "frpMW"],
    ...(points.length ? points.map(point => ["observation", ...metadata, period.metric.status, point.id, point.sourceId, point.observedAt, ...point.coordinates, point.confidence, point.frpMw]) : [["metadata", ...metadata, period.metric.status, null, null, null, null, null, null, null]]),
  ]);
}
export function aggregateResearchCsv(result: ResearchAnalysisResult) {
  const metric = (entry: typeof result.primary.metric) => [entry.rawCount, JSON.stringify(entry.rawCountsBySource), entry.harmonizedCount, entry.status];
  return csv([[...headers, "bucket", "rawCount", "rawCountsBySource", "harmonizedCount", "status", "baseline", "delta", "scoreKind", "score", "anomalyStatus", "referenceYears", "partialPeriod"],
    [...context(result, "primary"), "period", ...metric(result.primary.metric), null, null, null, null, null, null, null],
    ...(result.comparison ? [[...context(result, "comparison"), "period", ...metric(result.comparison.metric), null, null, null, null, null, null, null]] : []),
    ...result.months.map(month => [...context(result, "primary"), month.month, ...metric(month.metric), month.anomaly.baselineValue, month.anomaly.delta, month.anomaly.scoreKind, month.anomaly.score, month.anomaly.status, month.anomaly.referenceYears.join(";"), month.isPartialPeriod]),
  ]);
}
export function downloadResearch(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function calendarPng(result: ResearchAnalysisResult, english: boolean): Promise<Blob> {
  await document.fonts.ready;
  const years = [...new Set(result.months.map(month => month.month.slice(0, 4)))];
  const canvas = document.createElement("canvas");
  canvas.width = 1600; canvas.height = 450 + years.length * 58 + Math.ceil(result.sources.length / 2) * 30;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("EXPORT_FAILED");
  ctx.fillStyle = "#0e0e0e"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  let y = 40;
  function line(text: string, size = 16) {
    ctx!.font = `${size}px "Plus Jakarta Sans", sans-serif`; ctx!.fillStyle = "#ffffff";
    // Wrap provenance instead of silently clipping long AOI/model/version values.
    let current = "";
    for (const char of text) {
      if (ctx!.measureText(current + char).width > 1510) { ctx!.fillText(current, 40, y); y += size + 8; current = ""; }
      current += char;
    }
    ctx!.fillText(current, 40, y); y += size + 10;
  }
  // Metadata gets its own dynamically sized canvas so arbitrary source/version names fit.
  const statistics = [...new Set(result.months.map(month => month.anomaly.baselineStatistic).filter(Boolean))].join(", ") || "unavailable";
  const metadata = [`PyroChronos · ${result.mode.toUpperCase()} · ${result.area.name}`, `${result.primary.period.start} → ${result.primary.period.end} UTC · AOI revision ${result.area.revision}`, ...(result.comparison ? [`Comparison: ${result.comparison.period.start} → ${result.comparison.period.end} UTC · ${result.comparison.days} days`] : []), `Unit: ${result.method.unit} · MODIS-equivalent · ${result.method.name} ${result.method.version} · ${result.method.validation}`, `Baseline: ${statistics} · previous ${result.baseline.windowYears} years · minimum ${result.baseline.minimumValidYears} · ${result.baseline.policyVersion}`, `Data: ${result.dataVersion} · Analysis: ${result.id}`, ...result.sources.map(source => `Source: ${JSON.stringify(source)}`), `AOI hash: ${result.area.geometryHash}`, `Monthly status: ${result.months.map(month => `${month.month}=${month.metric.status}/${month.anomaly.status}`).join("; ")}`, english ? "Legend: numeric MODIS-equivalent estimate; — unavailable; 0 means no recorded detections, not no fire." : "Legenda: angka estimasi setara MODIS; — tidak tersedia; 0 bukan bukti tidak ada api."];
  // Reserve enough room for every wrapped metadata character at a conservative width.
  canvas.height = 180 + years.length * 58 + metadata.reduce((sum, text) => sum + (Math.ceil(text.length / 125) + 1) * 30, 0);
  ctx.fillStyle = "#0e0e0e"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const text of metadata) line(text);
  y += 20;
  ctx.font = '16px "Plus Jakarta Sans", sans-serif';
  for (let month = 0; month < 12; month++) ctx.fillText(new Date(Date.UTC(2000, month)).toLocaleString(english ? "en" : "id", { month: "short", timeZone: "UTC" }), 140 + month * 118, y);
  for (const year of years) {
    y += 58; ctx.fillStyle = "#ffffff"; ctx.fillText(year, 40, y);
    for (let month = 1; month <= 12; month++) {
      const entry = result.months.find(item => item.month === `${year}-${String(month).padStart(2, "0")}`);
      ctx.fillStyle = entry?.metric.harmonizedCount != null ? "#ffffff" : "#bdbdbd";
      ctx.fillText(entry?.metric.harmonizedCount == null ? "—" : entry.metric.harmonizedCount.toLocaleString(english ? "en" : "id", { maximumFractionDigits: 1 }), 140 + (month - 1) * 118, y);
    }
  }
  return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("EXPORT_FAILED")), "image/png"));
}
