import { candidates, series } from "./data";
import { getRegion, type RegionId } from "./regions";
import type { Snapshot } from "./snapshot";

export function demoSnapshot(regionId: RegionId): Snapshot {
  const assessed = "2026-11-09T12:00:00Z";
  return {
    schemaVersion: "1",
    runId: `demo-${regionId}-v1`,
    regionId,
    boundaryVersion: getRegion(regionId)!.boundaryVersion,
    mode: "demo",
    status: "replay",
    evaluatedAt: assessed,
    ingestedAt: assessed,
    publishedAt: assessed,
    freshUntil: assessed,
    sources: [
      {
        id: "illustrative",
        product: "SIMULATED-NOT-FIRMS",
        version: "1",
        observedAt: assessed,
        ingestedAt: assessed,
        status: "available",
        checksum: "illustrative-no-raw-batch",
      },
    ],
    method: {
      name: "illustrative",
      version: "1",
      validation: "not-evaluated",
      baselinePeriod: null,
      unit: "detected-cell-days",
    },
    candidates: candidates[regionId].map((item) => ({
      id: item.id,
      name: item.name,
      district: item.district,
      lat: item.lat,
      lng: item.lng,
      observedAt: new Date(
        Date.parse(assessed) - item.hours * 3600000,
      ).toISOString(),
      repeats: item.repeats,
      anomaly: item.anomaly,
      priority: item.priority === "Tinggi" ? "high" : "medium",
      sensor: item.sensor,
      reason: {
        id: "Contoh deteksi berulang dengan pembanding historis simulasi; belum tervalidasi.",
        en: "Example of repeated detections with simulated historical context; not validated.",
      },
    })),
    series: series.map((item, index) => ({
      at: new Date(
        Date.parse(assessed) - (13 - index) * 86400000,
      ).toISOString(),
      observed:
        regionId === "papua" ? Math.round(item.current * 0.8) : item.current,
      baseline: item.historical,
    })),
    coverage: null,
  };
}
