import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { researchContracts as schemas } from "../src/lib/research-contracts.ts";

const python = process.env.PYTHON || "python";
const out = mkdtempSync(path.join(tmpdir(), "adapter-"));
const run = spawnSync(
  python,
  ["-m", "unittest", "test_research_adapter.AdapterTests.test_dump_outputs_for_schema_validation"],
  {
    cwd: new URL("../pipeline/", import.meta.url),
    env: { ...process.env, ADAPTER_OUT: out },
    encoding: "utf8",
  },
);
const read = (name) => JSON.parse(readFileSync(path.join(out, name), "utf8"));

test("python adapter produced the synthetic fixture outputs", () => {
  assert.equal(run.status, 0, run.stderr);
});
test("result payloads from the producer pass the research-2 schema", () => {
  for (const name of ["result.json", "result-no-data.json", "result-antimeridian.json"])
    schemas.result.parse(read(name));
});
test("producer output never publishes estimates without validation", () => {
  const result = schemas.result.parse(read("result.json"));
  assert.equal(result.method.validation, "unsupported");
  for (const entry of [result.primary, result.comparison, ...result.months.map((m) => ({ metric: m.metric }))])
    assert.equal(entry.metric.harmonizedCount, null);
  const empty = schemas.result.parse(read("result-no-data.json"));
  assert.equal(empty.primary.metric.rawCount, null);
  assert.equal(empty.primary.metric.status, "no_data");
});
test("area, daily page and detections page pass the schema", () => {
  schemas.area.parse(read("area.json"));
  schemas["daily-page"].parse(read("daily-page.json"));
  const page = schemas["detections-page"].parse(read("detections-page.json"));
  assert(page.observations.length <= 1000);
});
test("cleanup", () => rmSync(out, { recursive: true, force: true }));
