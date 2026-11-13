import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(pathToFileURL(resolve("src", `${specifier.slice(2)}.ts`)).href, context);
  return next(specifier, context);
} });
const { POST } = await import("../src/app/api/local-research/route.ts");
const call = body => POST(new Request("http://localhost/api/local-research", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

test("anonymous analysis uses an isolated dataset and returns a validated raw result", async () => {
  const root = mkdtempSync(join(tmpdir(), "pyro-local-test-"));
  const previous = process.env.RESEARCH_DATA_DIR;
  process.env.RESEARCH_DATA_DIR = root;
  try {
    const areaResponse = await call({ action: "area", workspaceId: "local-test", area: { requestId: randomUUID(), name: "Test", geometry: { type: "Polygon", coordinates: [[[113,-3],[114,-3],[114,-2],[113,-2],[113,-3]]] } } });
    assert.equal(areaResponse.status, 200);
    const area = await areaResponse.json();
    const request = { requestId: randomUUID(), areaId: area.id, areaRevision: 1, period: { start: "2019-01-01", end: "2019-01-02" }, comparisonPeriod: null, baseline: { kind: "rolling-same-calendar-period", windowYears: 10 }, referenceScale: "MODIS-equivalent", qualityPolicyVersion: "quality-policy-1", monitoringLocationId: null };
    const response = await call({ action: "analyze", workspaceId: "local-test", area, request });
    assert.equal(response.status, 200);
    const bundle = await response.json();
    assert.equal(bundle.result.area.id, area.id);
    assert.equal(bundle.result.primary.metric.status, "no_data");
    assert.equal(bundle.result.primary.metric.harmonizedCount, null);
    assert.equal(bundle.days.length, 1);
    const changed = await call({ action: "analyze", workspaceId: "other", area, request });
    assert.equal(changed.status, 400);
  } finally {
    if (previous === undefined) delete process.env.RESEARCH_DATA_DIR; else process.env.RESEARCH_DATA_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test("anonymous analysis rejects cross-origin and oversized requests", async () => {
  const cross = await POST(new Request("http://localhost/api/local-research", { method: "POST", headers: { host: "localhost", origin: "https://other.example", "content-type": "application/json" }, body: "{}" }));
  assert.equal(cross.status, 403);
  const oversized = await POST(new Request("http://localhost/api/local-research", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: "x".repeat(100_000) }) }));
  assert.equal(oversized.status, 400);
});
