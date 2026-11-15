import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(pathToFileURL(resolve("src", `${specifier.slice(2)}.ts`)).href, context);
  return next(specifier, context);
} });
const { POST } = await import("../src/app/api/local-research/route.ts");
const { researchErrorSchema } = await import("../src/lib/research-contracts.ts");
const call = body => POST(new Request("http://localhost/api/local-research", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
// A configured archive can lack the selected dates; an entirely empty folder cannot.
function seedArchive(root) {
  mkdirSync(join(root, "MODIS_SP"));
  writeFileSync(join(root, "MODIS_SP", "manifest.jsonl"), JSON.stringify({ detections_format: "pcd1", year: 2010, sha256: "a".repeat(64), first_observed: "2010-01-01T00:00:00Z", last_observed: "2010-01-01T00:00:00Z", months: [], detections: 0 }) + "\n");
}

test("anonymous route preserves safe upstream error codes and hides arbitrary diagnostics", async () => {
  const previous = { url: process.env.PIPELINE_URL, data: process.env.RESEARCH_DATA_DIR, fetch: globalThis.fetch };
  process.env.PIPELINE_URL = "https://internal.invalid/";
  delete process.env.RESEARCH_DATA_DIR;
  try {
    const area = await (await call({ action: "area", workspaceId: "diagnostic-test", area: { requestId: randomUUID(), name: "Test", geometry: { type: "Polygon", coordinates: [[[113,-3],[114,-3],[114,-2],[113,-3]]] } } })).json();
    const request = { requestId: randomUUID(), areaId: area.id, areaRevision: 1, period: { start: "2019-01-01", end: "2019-01-01" }, comparisonPeriod: null, baseline: { kind: "rolling-same-calendar-period", windowYears: 10 }, referenceScale: "MODIS-equivalent", qualityPolicyVersion: "quality-policy-1", monitoringLocationId: null };
    for (const code of ["NOT_CONFIGURED", "NETWORK_ERROR", "TIMEOUT", "UPSTREAM_DENIED", "CAPACITY_LIMIT", "RATE_LIMITED", "PAYLOAD_TOO_LARGE", "private-diagnostic-with-key"]) {
      globalThis.fetch = async () => Response.json({ code }, { status: 503 });
      const response = await call({ action: "analyze", workspaceId: "diagnostic-test", area, request });
      const expected = code.startsWith("private") ? "DEPENDENCY_UNAVAILABLE" : code;
      assert.equal(response.status, code === "PAYLOAD_TOO_LARGE" ? 413 : code === "RATE_LIMITED" ? 429 : 503);
      assert.deepEqual(researchErrorSchema.parse(await response.json()), { schemaVersion: "research-2", error: expected.replaceAll("_", " "), code: expected, retryable: ["DEPENDENCY_UNAVAILABLE", "CAPACITY_LIMIT", "RATE_LIMITED"].includes(expected), requestId: request.requestId });
      assert.equal(response.headers.get("Retry-After"), code === "CAPACITY_LIMIT" ? "2" : code === "RATE_LIMITED" ? "60" : null);
    }
  } finally {
    globalThis.fetch = previous.fetch;
    if (previous.url === undefined) delete process.env.PIPELINE_URL; else process.env.PIPELINE_URL = previous.url;
    if (previous.data === undefined) delete process.env.RESEARCH_DATA_DIR; else process.env.RESEARCH_DATA_DIR = previous.data;
  }
});

test("anonymous analysis rejects an empty archive but preserves no_data for uncovered dates in a configured archive", async () => {
  const root = mkdtempSync(join(tmpdir(), "pyro-local-test-"));
  const previous = process.env.RESEARCH_DATA_DIR;
  process.env.RESEARCH_DATA_DIR = root;
  try {
    const areaResponse = await call({ action: "area", workspaceId: "local-test", area: { requestId: randomUUID(), name: "Test", geometry: { type: "Polygon", coordinates: [[[113,-3],[114,-3],[114,-2],[113,-2],[113,-3]]] } } });
    assert.equal(areaResponse.status, 200);
    const area = await areaResponse.json();
    const request = { requestId: randomUUID(), areaId: area.id, areaRevision: 1, period: { start: "2019-01-01", end: "2019-01-02" }, comparisonPeriod: null, baseline: { kind: "rolling-same-calendar-period", windowYears: 10 }, referenceScale: "MODIS-equivalent", qualityPolicyVersion: "quality-policy-1", monitoringLocationId: null };
    const empty = await call({ action: "analyze", workspaceId: "local-test", area, request });
    assert.equal(empty.status, 503);
    assert.equal((await empty.json()).code, "NOT_CONFIGURED");
    seedArchive(root);
    const response = await call({ action: "analyze", workspaceId: "local-test", area, request });
    assert.equal(response.status, 200);
    const bundle = await response.json();
    assert.equal(bundle.result.area.id, area.id);
    assert.equal(bundle.result.primary.metric.status, "no_data");
    assert.equal(bundle.result.primary.metric.harmonizedCount, null);
    assert.equal(bundle.days.length, 1);
    // Anonymous requestId is not a persisted queue/idempotency receipt.
    const duplicate = await call({ action: "analyze", workspaceId: "local-test", area, request });
    assert.equal(duplicate.status, 200);
    assert.notEqual((await duplicate.json()).result.id, bundle.result.id);
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
  assert.equal(oversized.status, 413);
  assert.equal((await oversized.json()).code, "PAYLOAD_TOO_LARGE");
  assert.equal(oversized.headers.get("Retry-After"), null);
});

test("aborted anonymous producer returns no partial bundle and releases admission for a fresh request",async()=>{
  const root=mkdtempSync(join(tmpdir(),"pyro-abort-"));
  seedArchive(root);
  const previous=process.env.RESEARCH_DATA_DIR;
  process.env.RESEARCH_DATA_DIR=root;
  try {
    const area=await (await call({action:"area",workspaceId:"abort-test",area:{requestId:randomUUID(),name:"Synthetic",geometry:{type:"Polygon",coordinates:[[[113,-3],[114,-3],[114,-2],[113,-2],[113,-3]]]}}})).json();
    const request={requestId:randomUUID(),areaId:area.id,areaRevision:1,period:{start:"2019-01-01",end:"2019-01-02"},comparisonPeriod:null,baseline:{kind:"rolling-same-calendar-period",windowYears:10},referenceScale:"MODIS-equivalent",qualityPolicyVersion:"quality-policy-1",monitoringLocationId:null};
    const body={action:"analyze",workspaceId:"abort-test",area,request};
    const response=await POST(new Request("http://localhost/api/local-research",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.abort()}));
    assert.equal(response.status,503);
    const failed=await response.json();
    assert.equal(failed.code,"DEPENDENCY_UNAVAILABLE");
    assert.equal(failed.result,undefined);
    assert.equal((await call(body)).status,200);
  } finally {if(previous===undefined)delete process.env.RESEARCH_DATA_DIR;else process.env.RESEARCH_DATA_DIR=previous;rmSync(root,{recursive:true,force:true});}
});

test("anonymous route validates a bundle received over the real Python HTTP adapter", async () => {
  const root = mkdtempSync(join(tmpdir(), "pyro-binding-test-"));
  seedArchive(root);
  const previous = { data: process.env.RESEARCH_DATA_DIR, url: process.env.PIPELINE_URL };
  const server = spawn(process.env.RESEARCH_PYTHON || "python", ["-u", "-c", [
    "from wsgiref.simple_server import make_server",
    "from app import app",
    "server = make_server('127.0.0.1', 0, app)",
    "print(server.server_port, flush=True)",
    "server.serve_forever()",
  ].join("\n")], { cwd: resolve("pipeline"), env: { ...process.env, RESEARCH_DATA_DIR: root }, stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  const exited = once(server, "exit");
  const lines = createInterface({ input: server.stdout });
  try {
    const port = await Promise.race([
      once(lines, "line").then(([line]) => Number(line)),
      exited.then(() => { throw new Error("Python service exited before starting"); }),
    ]);
    assert.ok(port > 0);
    process.env.PIPELINE_URL = `http://127.0.0.1:${port}/`;
    delete process.env.RESEARCH_DATA_DIR;
    const areaResponse = await call({ action: "area", workspaceId: "binding-test", area: { requestId: randomUUID(), name: "Test", geometry: { type: "Polygon", coordinates: [[[113,-3],[114,-3],[114,-2],[113,-2],[113,-3]]] } } });
    const area = await areaResponse.json();
    const request = { requestId: randomUUID(), areaId: area.id, areaRevision: 1, period: { start: "2019-01-01", end: "2019-01-02" }, comparisonPeriod: null, baseline: { kind: "rolling-same-calendar-period", windowYears: 10 }, referenceScale: "MODIS-equivalent", qualityPolicyVersion: "quality-policy-1", monitoringLocationId: null };
    const response = await call({ action: "analyze", workspaceId: "binding-test", area, request });
    assert.equal(response.status, 200);
    const bundle = await response.json();
    assert.equal(bundle.result.area.id, area.id);
    assert.equal(bundle.result.primary.metric.status, "no_data");
    assert.equal(bundle.result.primary.metric.harmonizedCount, null);
    assert.equal(bundle.days.length, 1);
  } finally {
    lines.close();
    server.kill();
    await exited;
    if (previous.data === undefined) delete process.env.RESEARCH_DATA_DIR; else process.env.RESEARCH_DATA_DIR = previous.data;
    if (previous.url === undefined) delete process.env.PIPELINE_URL; else process.env.PIPELINE_URL = previous.url;
    rmSync(root, { recursive: true, force: true });
  }
});
