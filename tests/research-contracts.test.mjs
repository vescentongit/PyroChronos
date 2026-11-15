import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { researchContracts as schemas } from "../src/lib/research-contracts.ts";

const fixtures = JSON.parse(
  readFileSync(
    new URL("../docs/contracts/api-v2.examples.json", import.meta.url),
  ),
).examples;
const fixture = (name) => structuredClone(fixtures[name]);

test("every v2 target resource has a valid synthetic integration example", () => {
  for (const [name, schema] of Object.entries(schemas))
    schema.parse(fixture(name));
});
test("free AOIs require valid coordinates, closed rings and distinct vertices", () => {
  const value = fixture("area-create");
  value.geometry.coordinates[0].pop();
  assert(!schemas["area-create"].safeParse(value).success);
  const invalid = fixture("area-create");
  invalid.geometry.coordinates[0][1][1] = 95;
  assert(!schemas["area-create"].safeParse(invalid).success);
  invalid.geometry.coordinates = [
    [
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ],
  ];
  assert(!schemas["area-create"].safeParse(invalid).success);
});
test("analysis dates are inclusive, support arbitrary ranges and default to ten reference years", () => {
  const value = fixture("analysis-create");
  delete value.baseline.windowYears;
  value.period = { start: "2001-01-03", end: "2025-12-17" };
  assert.equal(
    schemas["analysis-create"].parse(value).baseline.windowYears,
    10,
  );
  value.period = { start: "2026-02-30", end: "2026-03-01" };
  assert(!schemas["analysis-create"].safeParse(value).success);
  value.period = { start: "2026-08-31", end: "2026-08-01" };
  assert(!schemas["analysis-create"].safeParse(value).success);
});
test("requests cannot inject workspace, author, calculated coordinates or revisions", () => {
  for (const [name, field] of [
    ["analysis-create", "workspaceId"],
    ["location-create", "coordinates"],
    ["assignment-create", "assignedBy"],
    ["report-create", "recordedBy"],
  ]) {
    const value = fixture(name);
    value[field] = "forged";
    assert(!schemas[name].safeParse(value).success);
  }
});
test("job transitions cannot expose results or false completion before successful publication", () => {
  const value = fixture("job");
  value.status = "running";
  assert(!schemas.job.safeParse(value).success);
  value.resultId = null;
  value.completedAt = null;
  schemas.job.parse(value);
  value.status = "failed";
  assert(!schemas.job.safeParse(value).success);
});
test("monthly counts may be fractional estimates while missing data cannot turn into zero", () => {
  schemas.result.parse(fixture("result"));
  const value = fixture("result");
  value.months[0].metric.status = "no_data";
  value.months[0].metric.rawCount = 0;
  assert(!schemas.result.safeParse(value).success);
});
test("rolling baselines reject target/future years, incomplete history and inconsistent differences", () => {
  for (const mutate of [
    (v) => {
      v.months[0].anomaly.referenceYears[9] = 2026;
    },
    (v) => {
      v.months[0].anomaly.referenceYears[0] = 2015;
    },
    (v) => {
      v.months[0].anomaly.referenceYears.pop();
    },
    (v) => {
      v.months[0].anomaly.delta = 99;
    },
  ]) {
    const value = fixture("result");
    mutate(value);
    assert(!schemas.result.safeParse(value).success);
  }
});
test("earliest years retain counts while insufficient-history anomalies remain null", () => {
  const value = fixture("result");
  value.primary.period = { start: "2001-08-01", end: "2001-08-31" };
  value.months[0].month = "2001-08";
  value.months[0].anomaly = {
    status: "insufficient_history",
    referenceYears: [2000],
    baselineStatistic: null,
    baselineValue: null,
    delta: null,
    scoreKind: null,
    score: null,
  };
  schemas.result.parse(value);
});
test("v1 cell-day units, unvalidated research estimates and incomplete calendars are rejected", () => {
  for (const mutate of [
    (v) => {
      v.method.unit = "detected-cell-days";
    },
    (v) => {
      v.mode = "research";
    },
    (v) => {
      v.months = [];
    },
    (v) => {
      v.primary.metric.rawCount = 999;
    },
    (v) => {
      v.area.workspaceId = "other-workspace";
    },
  ]) {
    const value = fixture("result");
    mutate(value);
    assert(!schemas.result.safeParse(value).success);
  }
});
test("download artifacts expose only authenticated application paths when ready", () => {
  const value = fixture("export");
  value.downloadPath = "https://firms.example.invalid/private-key";
  assert(!schemas.export.safeParse(value).success);
  value.downloadPath = null;
  assert(!schemas.export.safeParse(value).success);
});
