import assert from "node:assert/strict";
import { test } from "node:test";
import { parseFirmsCsv } from "../src/lib/firms-csv.ts";
import {
  boundsSchema,
  querySchema,
  normalizedBounds,
  aggregateDetections,
} from "../src/lib/hotspots.ts";

const header = "latitude,longitude,acq_date,acq_time,satellite,confidence,frp";
const row = "-2.5,114,2026-11-09,0015,20,n,12.5";
test("CSV parses timestamps, escaped fields, FRP and deduplicates reacquired records", () => {
  const points = parseFirmsCsv(
    `\uFEFF${header}\r\n${row}\r\n${row}\r\n-8,140,2026-11-09,15,20,"n",-999`,
    "VIIRS_NOAA20_NRT",
  );
  assert.equal(points.length, 2);
  assert.equal(points[0].observedAt, "2026-11-09T00:15:00.000Z");
  assert.equal(points[1].frp, null);
  assert.equal(parseFirmsCsv(header + "\n", "MODIS_NRT").length, 0);
});
test("invalid schemas, coordinates, times and malformed CSV fail rather than become zero", () => {
  for (const csv of [
    "API invalid key",
    header + "\n" + row.replace("-2.5", "-95"),
    header + "\n" + row.replace("0015", "2460"),
    header + "\n" + row.replace("2026-11-09", "2026-02-30"),
    header + '\n"bad',
    header + "\n" + row.replace("12.5", "invalid"),
  ])
    assert.throws(() => parseFirmsCsv(csv, "MODIS_NRT"));
});
test("viewport and whitelist validation supports crossing the antimeridian", () => {
  assert(boundsSchema.safeParse([170, -20, -170, 20]).success);
  assert(!boundsSchema.safeParse([180, -20, -180, 20]).success);
  assert(!boundsSchema.safeParse([0, 20, 10, -20]).success);
  assert.deepEqual(normalizedBounds(170, -20, 190, 20), [170, -20, -170, 20]);
  assert.deepEqual(normalizedBounds(-200, -85, 200, 85), [-180, -85, 180, 85]);
  assert(
    !querySchema.safeParse({
      source: "https://evil",
      hours: 24,
      zoom: 2,
      bbox: [-180, -85, 180, 85],
    }).success,
  );
  assert(
    !querySchema.safeParse({
      source: "MODIS_NRT",
      hours: 168,
      zoom: 2,
      bbox: [-180, -85, 180, 85],
    }).success,
  );
});
test("aggregation preserves total counts, handles antimeridian and rolling-window edges", () => {
  const evaluatedAt = "2026-11-09T12:00:00.000Z";
  const points = [179, -179, 0].map((lng, index) => ({
    id: String(index),
    lng,
    lat: 0,
    observedAt: evaluatedAt,
    satellite: "20",
    confidence: "n",
    frp: null,
  }));
  const query = {
    source: "MODIS_NRT",
    hours: 24,
    zoom: 2,
    bbox: [170, -20, -170, 20],
  };
  const result = aggregateDetections(points, query, evaluatedAt);
  assert.equal(result.total, 2);
  assert.equal(
    result.features.reduce((sum, item) => sum + item.properties.count, 0),
    2,
  );
  const edges = [24 * 3600000, 24 * 3600000 + 1, -1].map((age, index) => ({
    ...points[0],
    id: `edge${index}`,
    observedAt: new Date(Date.parse(evaluatedAt) - age).toISOString(),
  }));
  assert.equal(aggregateDetections(edges, query, evaluatedAt).total, 1);
});
test("dense viewports stay bounded without truncating detection counts", () => {
  const evaluatedAt = "2026-11-09T12:00:00.000Z";
  const points = Array.from({ length: 10000 }, (_, index) => ({
    id: String(index),
    lng: -179 + (index % 200) * 1.7,
    lat: -80 + Math.floor(index / 200) * 3,
    observedAt: evaluatedAt,
    satellite: "20",
    confidence: "n",
    frp: null,
  }));
  const result = aggregateDetections(
    points,
    { source: "MODIS_NRT", hours: 24, zoom: 14, bbox: [-180, -90, 180, 90] },
    evaluatedAt,
  );
  assert(result.features.length <= 6000);
  assert.equal(result.total, 10000);
  assert.equal(
    result.features.reduce((sum, item) => sum + item.properties.count, 0),
    10000,
  );
  assert.equal(result.sample.length, 30);
});
