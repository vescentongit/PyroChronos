import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { studyRegions } from "../src/lib/regions.ts";
import { isFrontFacing, constrainZoom } from "../src/lib/globe-geometry.ts";
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
