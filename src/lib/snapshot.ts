import { z } from "zod";

const instant = z.string().datetime({ offset: true });
const nonnegative = z.number().finite().nonnegative();
const candidate = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  district: z.string(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  observedAt: instant,
  sensor: z.string().min(1),
  repeats: nonnegative.int().nullable(),
  anomaly: z.number().min(0).max(100).nullable(),
  priority: z.enum(["high", "medium"]).nullable(),
  reason: z.object({ id: z.string().min(1), en: z.string().min(1) }),
});

export const snapshotSchema = z
  .object({
    schemaVersion: z.literal("1"),
    runId: z.string().min(1),
    regionId: z.enum(["kalteng", "papua"]),
    boundaryVersion: z.string().min(1),
    mode: z.enum(["operational", "demo", "replay"]),
    status: z.enum(["live", "stale", "partial", "unavailable", "replay"]),
    evaluatedAt: instant,
    ingestedAt: instant,
    publishedAt: instant,
    freshUntil: instant,
    sources: z.array(
      z.object({
        id: z.string().min(1),
        product: z.string().min(1),
        version: z.string().min(1),
        observedAt: instant.nullable(),
        ingestedAt: instant.nullable(),
        status: z.enum(["available", "partial", "unavailable"]),
        checksum: z.string().min(1),
      }),
    ),
    method: z.object({
      name: z.string().min(1),
      version: z.string().min(1),
      validation: z.enum(["validated", "not-evaluated", "unsupported"]),
      baselinePeriod: z.string().nullable(),
      unit: z.literal("detected-cell-days"),
    }),
    candidates: z.array(candidate),
    series: z.array(
      z.object({
        at: instant,
        observed: nonnegative.nullable(),
        baseline: nonnegative.nullable(),
      }),
    ),
    // Version 1 only models FIRMS point data; QA-based denominators need a new contract.
    coverage: z.null(),
  })
  .superRefine((snapshot, context) => {
    const reject = (message: string) =>
      context.addIssue({ code: "custom", message });
    if (
      new Set(snapshot.candidates.map((item) => item.id)).size !==
      snapshot.candidates.length
    )
      reject("Duplicate candidate ID");
    if (Date.parse(snapshot.ingestedAt) > Date.parse(snapshot.publishedAt))
      reject("Ingest after publication");
    if (Date.parse(snapshot.evaluatedAt) > Date.parse(snapshot.publishedAt))
      reject("Assessment after publication");
    if (Date.parse(snapshot.freshUntil) < Date.parse(snapshot.publishedAt))
      reject("Invalid freshness window");
    if (
      snapshot.candidates.some(
        (item) =>
          Date.parse(item.observedAt) > Date.parse(snapshot.evaluatedAt),
      )
    )
      reject("Observation after assessment");
    if (
      new Set(snapshot.sources.map((source) => source.id)).size !==
      snapshot.sources.length
    )
      reject("Duplicate source ID");
    if (
      snapshot.series.some(
        (point, index) =>
          Date.parse(point.at) > Date.parse(snapshot.evaluatedAt) ||
          (index > 0 &&
            Date.parse(point.at) <= Date.parse(snapshot.series[index - 1].at)),
      )
    )
      reject("Series must be ordered and not future-dated");
    if (snapshot.mode !== "operational" && snapshot.status !== "replay")
      reject("Simulation must be labelled replay");
    if (
      snapshot.status === "live" &&
      (!snapshot.sources.length ||
        snapshot.sources.some((source) => source.status !== "available"))
    )
      reject("Live requires all sources");
    if (snapshot.mode === "operational" && !snapshot.sources.length)
      reject("Operational snapshot requires provenance");
    if (
      snapshot.mode === "operational" &&
      snapshot.method.validation !== "validated" &&
      snapshot.method.name !== "raw"
    )
      reject("Unvalidated calibration");
  });

export type Snapshot = z.infer<typeof snapshotSchema>;
export type SnapshotCandidate = Snapshot["candidates"][number];
export type DataMode = "demo" | "operational";

export function parseSnapshot(
  input: unknown,
  region: { id: string; boundaryVersion: string; bounds: readonly number[] },
  mode: DataMode,
): Snapshot {
  const snapshot = snapshotSchema.parse(input);
  if (
    snapshot.regionId !== region.id ||
    snapshot.boundaryVersion !== region.boundaryVersion
  )
    throw new Error("Region or boundary mismatch");
  if (mode === "operational" && snapshot.mode === "demo")
    throw new Error("Demo in operational response");
  const [west, south, east, north] = region.bounds;
  if (
    snapshot.candidates.some(
      (item) =>
        item.lng < west ||
        item.lng > east ||
        item.lat < south ||
        item.lat > north,
    )
  )
    throw new Error("Candidate outside study boundary");
  return snapshot;
}

export function snapshotStatus(
  snapshot: Snapshot,
  now: number,
  failed = false,
): Snapshot["status"] {
  if (snapshot.mode !== "operational" || snapshot.status === "replay")
    return "replay";
  if (snapshot.status === "unavailable") return "unavailable";
  return failed || now > Date.parse(snapshot.freshUntil)
    ? "stale"
    : snapshot.status;
}

export function candidateWindow(
  observedAt: string,
  assessedAt: string,
): "latest" | "older" | "history" {
  const age = Date.parse(assessedAt) - Date.parse(observedAt);
  if (age < 0 || !Number.isFinite(age)) return "history";
  return age <= 24 * 3600000
    ? "latest"
    : age <= 7 * 24 * 3600000
      ? "older"
      : "history";
}

export function snapshotCsv(
  snapshot: Snapshot,
  status: Snapshot["status"],
  language: "id" | "en",
) {
  const headers =
    language === "id"
      ? [
          "lokasi",
          "id_lokasi",
          "wilayah",
          "versi_batas",
          "lintang",
          "bujur",
          "waktu_observasi",
          "sensor",
          "pengulangan",
          "persentil",
          "prioritas",
          "mode",
          "status",
          "run",
          "waktu_penilaian",
          "waktu_ingest",
          "waktu_publikasi",
          "sumber",
          "metode",
          "periode_baseline",
          "satuan",
        ]
      : [
          "location",
          "location_id",
          "region",
          "boundary_version",
          "latitude",
          "longitude",
          "observed_at",
          "sensor",
          "repeated_observations",
          "percentile",
          "priority",
          "mode",
          "status",
          "run",
          "assessed_at",
          "ingested_at",
          "published_at",
          "sources",
          "method",
          "baseline_period",
          "unit",
        ];
  const entries = snapshot.candidates.length ? snapshot.candidates : [null];
  const rows = entries.map((item) => [
    item?.name,
    item?.id,
    snapshot.regionId,
    snapshot.boundaryVersion,
    item?.lat,
    item?.lng,
    item?.observedAt,
    item?.sensor,
    item?.repeats,
    item?.anomaly,
    item?.priority,
    snapshot.mode,
    status,
    snapshot.runId,
    snapshot.evaluatedAt,
    snapshot.ingestedAt,
    snapshot.publishedAt,
    snapshot.sources
      .map((source) => `${source.product}@${source.version}:${source.checksum}`)
      .join(";"),
    `${snapshot.method.name}@${snapshot.method.version}`,
    snapshot.method.baselinePeriod,
    snapshot.method.unit,
  ]);
  return (
    "\uFEFF" +
    [headers, ...rows]
      .map((row) =>
        row
          .map((value) => {
            const cell = String(value ?? "");
            // Spreadsheet formula protection also applies to upstream location names.
            return `"${(typeof value === "string" && /^[=+@\-\t\r]/.test(cell) ? "'" + cell : cell).replaceAll('"', '""')}"`;
          })
          .join(","),
      )
      .join("\r\n")
  );
}
