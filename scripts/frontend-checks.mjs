import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { studyRegions } from "../src/lib/regions.ts";
import { isFrontFacing, constrainZoom, globeMapHref, readGlobeLocation, globeLocationBounds, globePoints } from "../src/lib/globe-geometry.ts";
import {
  candidateWindow,
  parseSnapshot,
  snapshotCsv,
  snapshotStatus,
} from "../src/lib/snapshot.ts";

const example = JSON.parse(
  readFileSync(
    new URL("../docs/contracts/snapshot-v1.example.json", import.meta.url),
  ),
);
const region = studyRegions[0];
const make = () => structuredClone(example);

test("globe navigation preserves worldwide coordinates and rejects malformed links", () => {
  for (const point of [{ lng: -63.25, lat: -14.5 }, { lng: 179.99, lat: 20 }, { lng: -180, lat: 90 }]) {
    const params = new URLSearchParams(globeMapHref(point).split("?")[1]);
    assert.deepEqual(readGlobeLocation(params), point);
    const bounds = globeLocationBounds(point);
    assert(bounds[1] >= -85 && bounds[3] <= 85);
  }
  assert(globeLocationBounds({ lng: 179.99, lat: 20 })[0] > globeLocationBounds({ lng: 179.99, lat: 20 })[2]);
  for (const input of ["", "lng=&lat=0", "lng=1", "lng=NaN&lat=0", "lng=1&lat=Infinity", "lng=181&lat=0", "lng=0&lat=-91", "lng=1&lng=2&lat=3"]) {
    assert.equal(readGlobeLocation(new URLSearchParams(input)), null, input);
  }
});

test("globe uses every spatial bin and preserves counts rather than the preview sample", () => {
  const rows = [-120, 20, 119].map(lng => [lng, -4, 12, "2026-11-15T00:00:00.000Z"]);
  const points = globePoints(rows);
  assert.equal(points.length, 3);
  assert.equal(points.reduce((sum, point) => sum + point.count, 0), 36);
  assert.deepEqual(points.map(point => point.lng), [-120, 20, 119]);
});

test("bundled FIRMS snapshot has a fixed seven-day period, worldwide coverage and exact counts", () => {
  const snapshot = JSON.parse(readFileSync(new URL("../src/data/globe-hotspots.json", import.meta.url)));
  assert.equal(snapshot.schemaVersion, "globe-snapshot-1");
  assert.equal(snapshot.source, "VIIRS_NOAA20_NRT");
  assert.equal(Date.parse(snapshot.periodEnd) - Date.parse(snapshot.periodStart), 7 * 86400000);
  assert.match(snapshot.checksum, /^sha256:[a-f0-9]{64}$/);
  assert.equal(snapshot.total, 372148);
  const points = globePoints(snapshot.points);
  assert.equal(points.reduce((sum, p) => sum + p.count, 0), snapshot.total);
  assert(points.length > 1000 && points.length <= 6000);
  assert.equal(new Set(points.map(p => p.id)).size, points.length);
  assert(points.every(p => Number.isInteger(p.count) && p.count > 0 && Math.abs(p.lng) <= 180 && Math.abs(p.lat) <= 90 &&
    Date.parse(p.observedAt) >= Date.parse(snapshot.periodStart) && Date.parse(p.observedAt) < Date.parse(snapshot.periodEnd)));
  for (const quadrant of [p => p.lng < 0 && p.lat < 0, p => p.lng < 0 && p.lat > 0,
    p => p.lng > 0 && p.lat < 0, p => p.lng > 0 && p.lat > 0]) assert(points.some(quadrant));
  assert(points.filter(p => isFrontFacing([p.lng, p.lat], [119, -4])).length > 100);
});

test("globe clips the far hemisphere and bounds interactive zoom", () => {
  assert.equal(isFrontFacing([119, -4], [119, -4]), true);
  assert.equal(isFrontFacing([-61, 4], [119, -4]), false);
  assert.equal(isFrontFacing([90, 0], [0, 0]), false);
  assert.equal(constrainZoom(0.1), 0.7);
  assert.equal(constrainZoom(4), 1.65);
  assert.equal(constrainZoom(1.2), 1.2);
  const dots = JSON.parse(
    readFileSync(new URL("../public/geo/land-dots.json", import.meta.url)),
  );
  assert(dots.points.length > 2000);
  assert(
    dots.points.every(
      ([longitude, latitude]) =>
        longitude >= -180 &&
        longitude <= 180 &&
        latitude >= -90 &&
        latitude <= 90,
    ),
  );
});

test("shared study registry has closed polygons, positive areas and all candidates inside", () => {
  assert.deepEqual(
    studyRegions.map((item) => item.id),
    ["kalteng", "papua"],
  );
  for (const item of studyRegions) {
    assert(item.areaKm2 > 0);
    assert.equal(item.approval, "pending");
    assert.deepEqual(
      item.geometry.coordinates[0][0],
      item.geometry.coordinates[0].at(-1),
    );
    const input = make();
    input.regionId = item.id;
    input.candidates[0].lng = (item.bounds[0] + item.bounds[2]) / 2;
    input.candidates[0].lat = (item.bounds[1] + item.bounds[3]) / 2;
    assert.equal(parseSnapshot(input, item, "operational").regionId, item.id);
  }
});

test("partial evidence remains null, not zero", () => {
  const parsed = parseSnapshot(make(), region, "operational");
  assert.equal(parsed.candidates[0].anomaly, null);
  assert.equal(parsed.series[0].observed, null);
  assert.equal(parsed.coverage, null);
});

test("region, boundary, demo leakage and out-of-polygon points are rejected", () => {
  for (const mutate of [
    (input) => (input.regionId = "papua"),
    (input) => (input.boundaryVersion = "other"),
    (input) => (input.mode = "demo"),
    (input) => (input.candidates[0].lng = 150),
  ]) {
    const input = make();
    mutate(input);
    assert.throws(() => parseSnapshot(input, region, "operational"));
  }
});

test("future observations, duplicate candidates and fake coverage cannot be published", () => {
  for (const mutate of [
    (input) => (input.candidates[0].observedAt = "2026-11-10T00:00:00Z"),
    (input) => input.candidates.push(input.candidates[0]),
    (input) => (input.coverage = 100),
    (input) => input.series.reverse(),
    (input) => (input.method.name = "EQM"),
  ]) {
    const input = make();
    input.mode = "operational";
    input.status = "partial";
    mutate(input);
    assert.throws(() => parseSnapshot(input, region, "operational"));
  }
});

test("live requires source availability; failure and expiry mark cache stale", () => {
  const input = make();
  input.mode = "operational";
  input.status = "live";
  const parsed = parseSnapshot(input, region, "operational");
  assert.equal(snapshotStatus(parsed, Date.parse(parsed.publishedAt)), "live");
  assert.equal(
    snapshotStatus(parsed, Date.parse(parsed.freshUntil) + 1),
    "stale",
  );
  assert.equal(
    snapshotStatus(parsed, Date.parse(parsed.publishedAt), true),
    "stale",
  );
  input.sources[0].status = "unavailable";
  assert.throws(() => parseSnapshot(input, region, "operational"));
  assert.equal(snapshotStatus(example, Date.now(), true), "replay");
});

test("24-hour and seven-day boundaries are mutually exclusive", () => {
  const assessed = example.evaluatedAt;
  const before = (milliseconds) =>
    new Date(Date.parse(assessed) - milliseconds).toISOString();
  assert.equal(candidateWindow(before(24 * 3600000), assessed), "latest");
  assert.equal(candidateWindow(before(24 * 3600000 + 1), assessed), "older");
  assert.equal(candidateWindow(before(7 * 86400000), assessed), "older");
  assert.equal(candidateWindow(before(7 * 86400000 + 1), assessed), "history");
  assert.equal(candidateWindow(before(-1), assessed), "history");
});

test("CSV escapes formulas and quotes, retains numeric negative latitude and provenance", () => {
  const input = make();
  input.candidates[0].name = '=SUM(1,2)"';
  const csv = snapshotCsv(input, "stale", "en");
  assert(csv.includes('"\'=SUM(1,2)"""'));
  assert(csv.includes('"-2.5"'));
  assert(csv.includes(input.publishedAt));
  assert(csv.includes('"stale"'));
  assert(csv.includes(input.runId));
  input.candidates = [];
  const empty = snapshotCsv(input, "replay", "id");
  assert(empty.includes(input.runId));
  assert(empty.includes(input.sources[0].checksum));
  assert.equal(empty.split("\r\n").length, 2);
});
