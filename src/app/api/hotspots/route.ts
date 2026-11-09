import { NextRequest, NextResponse } from "next/server";
import { querySchema, aggregateDetections } from "@/lib/hotspots";
import {
  getFirmsBatch,
  FirmsError,
  firmsFreshUntil,
} from "@/lib/firms-service";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const parsed = querySchema.safeParse({
    source: params.get("source") || "VIIRS_NOAA20_NRT",
    hours: Number(params.get("hours") || 24),
    zoom: Number(params.get("zoom") || 2),
    bbox: (params.get("bbox") || "")
      .split(",")
      .map((value) => (value.trim() ? Number(value) : NaN)),
  });
  if (!parsed.success)
    return NextResponse.json(
      {
        error: "Invalid viewport, source or period.",
        code: "INVALID_REQUEST",
        retryable: false,
        requestId: null,
      },
      { status: 400 },
    );
  try {
    const batch = await getFirmsBatch(parsed.data);
    const evaluatedAt = new Date().toISOString();
    return NextResponse.json(
      {
        schemaVersion: "hotspots-1",
        ...parsed.data,
        status: batch.status,
        fetchedAt: batch.fetchedAt,
        evaluatedAt,
        freshUntil: firmsFreshUntil(batch.fetchedAt),
        observedFrom: new Date(
          Date.parse(evaluatedAt) - parsed.data.hours * 3600000,
        ).toISOString(),
        observedTo: evaluatedAt,
        checksum: batch.checksum,
        unit: "detections",
        ...aggregateDetections(batch.rows, parsed.data, evaluatedAt),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const known =
      error instanceof FirmsError
        ? error
        : new FirmsError("DEPENDENCY_UNAVAILABLE", 503);
    return NextResponse.json(
      {
        error: "FIRMS data is not available. Retry or choose a shorter period.",
        code: known.code === "NOT_CONFIGURED" ? "DEPENDENCY_UNAVAILABLE" : known.code,
        retryable: known.code !== "NOT_CONFIGURED",
        requestId: null,
      },
      {
        status: known.status,
        headers: { "Cache-Control": "no-store", "Retry-After": "60" },
      },
    );
  }
}
