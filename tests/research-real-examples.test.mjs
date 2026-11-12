import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { researchContracts as schemas } from "../src/lib/research-contracts.ts";

const load = (...parts) =>
  JSON.parse(readFileSync(new URL(`../docs/data/examples/${parts.join("/")}`, import.meta.url), "utf8"));

test("real validated-domain example passes the research-2 contract", () => {
  const result = schemas.result.parse(load("amazon-rondonia-2024", "result.json"));
  assert.equal(result.method.validation, "validated");
  assert.equal(result.mode, "research");
  assert.deepEqual(result.months.map((m) => m.month), ["2024-08", "2024-09"]);
  assert(result.months.every((m) => m.metric.harmonizedCount !== null));
  assert(result.months.every((m) => m.anomaly.status === "assessed"));
  const total = result.months.reduce((sum, m) => sum + m.metric.harmonizedCount, 0);
  assert(Math.abs(total - result.primary.metric.harmonizedCount) < 1e-6);
  assert(result.comparison.metric.harmonizedCount !== null);
  const manifest = load("amazon-rondonia-2024", "manifest.json");
  assert.equal(manifest.id, result.method.manifestId);
  assert.equal(manifest.harmonization.polygonSupported, true);
  const page = schemas["daily-page"].parse(load("amazon-rondonia-2024", "daily-2024-08.json"));
  const daily = page.days.reduce((sum, d) => sum + d.metric.harmonizedCount, 0);
  assert(Math.abs(daily - result.months[0].metric.harmonizedCount) < 1e-4);
});

test("real unvalidated-domain example withholds the estimate", () => {
  const result = schemas.result.parse(load("kalteng-2023", "result.json"));
  assert.equal(result.method.validation, "unsupported");
  assert.equal(result.primary.metric.harmonizedCount, null);
  assert(result.months.every((m) => m.anomaly.status === "method_unsupported"));
  assert(result.primary.metric.rawCount > 0);
  const manifest = load("kalteng-2023", "manifest.json");
  assert.equal(manifest.harmonization.polygonSupported, false);
  assert(manifest.harmonization.polygonDomains.includes("maritime_southeast_asia"));
  schemas["daily-page"].parse(load("kalteng-2023", "daily-2023-08.json"));
});
