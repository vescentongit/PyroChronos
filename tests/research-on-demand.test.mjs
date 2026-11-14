import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { registerHooks } from "node:module";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) return next(pathToFileURL(resolve("src", `${specifier.slice(2)}.ts`)).href, context);
  if (context.parentURL?.includes("/src/lib/") && specifier.startsWith("./") && !/\.[a-z]+$/i.test(specifier)) return next(`${specifier}.ts`, context);
  return next(specifier, context);
} });
const { POST } = await import("../src/app/api/local-research/route.ts");
const { submitResearch, getBundle, listResearchWorkspaces, createResearchWorkspace, createResearchArea, openResearchResult } = await import("../src/lib/local-research-client.ts");
const { researchStages, combineResearchStages, availableSourceRanges } = await import("../src/lib/research-stages.ts");

test("source date guidance uses actual snapshot availability, never observation dates", () => {
  const range = { MODIS_SP: ["2000-11-01", "2025-12-31"] };
  assert.deepEqual(availableSourceRanges({ stages: [{ manifest: { snapshot: { availability: range } } }] }), range);
  assert.deepEqual(availableSourceRanges({ snapshot: { availability: range } }), range);
  assert.deepEqual(availableSourceRanges({ snapshot: { availability: { MODIS_SP: ["invalid", "2025-12-31"] } } }), {});
  assert.deepEqual(availableSourceRanges({}), {});
});

test("monthly boundaries preserve partial periods and leap days", () => {
  const stages = researchStages({ period: { start: "2020-01-30", end: "2020-03-01" }, comparisonPeriod: null });
  assert.deepEqual(stages.map(item => item.period), [
    { start: "2020-01-30", end: "2020-01-31" }, { start: "2020-02-01", end: "2020-02-29" }, { start: "2020-03-01", end: "2020-03-01" },
  ]);
});

test("blocked IndexedDB reports storage failure instead of invalid input", async () => {
  const previous = globalThis.indexedDB;
  globalThis.indexedDB = { open() { throw new DOMException("Blocked", "SecurityError"); } };
  try {
    await assert.rejects(getBundle("blocked-storage-regression"), error => error.code === "STORAGE_UNAVAILABLE");
  } finally { globalThis.indexedDB = previous; }
});

test("workspace storage failures retain a storage error code", async t => {
  const previous = globalThis.localStorage;
  try {
    for (const access of ["getItem", "setItem"]) {
      await t.test(access, async () => {
        globalThis.localStorage = { getItem: () => null, setItem() {}, [access]() { throw new DOMException("Full or blocked", "QuotaExceededError"); } };
        await assert.rejects(listResearchWorkspaces(new AbortController().signal), error => error.code === "STORAGE_UNAVAILABLE");
      });
    }
    await t.test("create", async () => {
      await assert.rejects(createResearchWorkspace({ requestId: crypto.randomUUID(), name: "Storage test" }, new AbortController().signal), error => error.code === "STORAGE_UNAVAILABLE");
    });
    await t.test("invalid saved workspace", async () => {
      globalThis.localStorage = { getItem: () => '{"id":null}', setItem() {} };
      await assert.rejects(listResearchWorkspaces(new AbortController().signal), error => error.code === "STORAGE_UNAVAILABLE");
    });
  } finally { globalThis.localStorage = previous; }
});

test("browser resumes saved months through real Next → Python HTTP analysis and retains provenance", async () => {
  const previous = { fetch: globalThis.fetch, db: globalThis.indexedDB, storage: globalThis.localStorage, url: process.env.PIPELINE_URL, data: process.env.RESEARCH_DATA_DIR };
  const server = spawn(process.env.RESEARCH_PYTHON || "python", ["-u", "-c", [
    "from wsgiref.simple_server import make_server",
    "import firms_on_demand",
    "from test_firms_on_demand import OnDemandTests",
    "firms_on_demand.download = OnDemandTests().fetch",
    "from app import app",
    "server = make_server('127.0.0.1', 0, app)",
    "print(server.server_port, flush=True)",
    "server.serve_forever()",
  ].join("\n")], { cwd: resolve("pipeline"), env: { ...process.env, RESEARCH_DATA_DIR: "", FIRMS_BLOB_BASE_URL: "", FIRMS_MAP_KEY: "synthetic-key" }, stdio: ["ignore", "pipe", "ignore"] });
  const exited = once(server, "exit");
  const lines = createInterface({ input: server.stdout });
  const stored = new Map(), metadata = new Map(), calls = [];
  let storageFailure, abortFinal;
  const notify = callback => queueMicrotask(callback);
  globalThis.localStorage = { getItem: key => metadata.get(key) ?? null, setItem: (key, value) => {
    if ((storageFailure === "history" && key === "pyro-research-history-v1") || storageFailure === key) throw new DOMException("Full", "QuotaExceededError");
    metadata.set(key, String(value));
  } };
  globalThis.indexedDB = { open() {
    const request = { result: { close() {}, transaction() {
      const tx = { objectStore() { return {
        get(id) { const op = { result: structuredClone(stored.get(id)) }; notify(() => op.onsuccess()); return op; },
        put(value) {
          if (storageFailure === "put") throw new DOMException("Full", "QuotaExceededError");
          stored.set(value.result.id, structuredClone(value)); notify(() => { if (value.result.id.startsWith("staged-")) abortFinal?.abort(); tx.oncomplete(); });
        },
      }; } };
      return tx;
    } } };
    notify(() => request.onsuccess());
    return request;
  } };
  try {
    const port = await Promise.race([once(lines, "line").then(([value]) => Number(value)), exited.then(() => { throw new Error("Python HTTP fixture could not start"); })]);
    process.env.PIPELINE_URL = `http://127.0.0.1:${port}/`;
    delete process.env.RESEARCH_DATA_DIR;
    let failSecond = true;
    globalThis.fetch = async (url, options) => {
      if (url !== "/api/local-research") return previous.fetch(url, options);
      const body = JSON.parse(options.body);
      calls.push(body);
      if (calls.length === 2 && failSecond) return Response.json({ code: "DEPENDENCY_UNAVAILABLE" }, { status: 503 });
      return POST(new Request("http://localhost/api/local-research", options));
    };
    const areaResponse = await POST(new Request("http://localhost/api/local-research", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "area", workspaceId: "staged-test", area: { requestId: crypto.randomUUID(), name: "Synthetic Amazon", geometry: { type: "Polygon", coordinates: [[[-61,-10],[-60.9,-10],[-60.9,-9.9],[-61,-10]]] } } }) }));
    const area = await areaResponse.json();
    metadata.set("pyro-local-areas-v1", JSON.stringify({ [area.id]: area }));
    const body = { requestId: crypto.randomUUID(), areaId: area.id, areaRevision: 1, period: { start: "2019-01-30", end: "2019-02-02" }, comparisonPeriod: { start: "2018-03-31", end: "2018-04-01" }, baseline: { kind: "rolling-same-calendar-period", windowYears: 10 }, referenceScale: "MODIS-equivalent", qualityPolicyVersion: "quality-policy-1", monitoringLocationId: null };
    let progress;
    await assert.rejects(submitResearch("staged-test", body, new AbortController().signal, { onProgress: value => { progress = value; } }), error => error.code === "DEPENDENCY_UNAVAILABLE");
    assert.deepEqual(progress.map(item => item.status), ["saved", "failed", "pending", "pending"]);
    assert.equal(metadata.has("pyro-last-research-v1"), false);
    assert.equal(stored.size, 1);
    failSecond = false;
    // A page reload/new area identity must still reuse the same immutable geometry/date snapshot.
    const replacement = { ...area, id: "new-area-id" };
    metadata.set("pyro-local-areas-v1", JSON.stringify({ [replacement.id]: replacement }));
    const job = await submitResearch("staged-test", { ...body, areaId: replacement.id }, new AbortController().signal, { onProgress: value => { progress = value; } });
    assert.equal(calls.length, 5);
    assert.ok(progress.every(item => item.status === "saved"));
    assert.deepEqual(calls.map(item => item.includeBaseline), [true, true, true, false, false]);
    const bundle = await getBundle(job.resultId);
    assert.equal(bundle.result.months.length, 2);
    assert.equal(bundle.result.primary.days, 4);
    assert.equal(bundle.result.comparison.days, 2);
    assert.equal(bundle.result.primary.metric.harmonizedCount, 0);
    assert.equal(bundle.result.comparison.metric.harmonizedCount, 0);
    assert.equal(bundle.days.filter(page => page.periodRole === "comparison").flatMap(page => page.days).length, 2);
    assert.ok(bundle.days.every(page => page.analysisId === bundle.result.id));
    assert.equal(bundle.manifest.stages.length, 4);
    assert.ok(bundle.manifest.stages[0].manifest.snapshot.baselineRequested);
    assert.equal(bundle.manifest.stages[2].manifest.snapshot.baselineRequested, false);
    assert.ok(bundle.result.months.every(month => month.anomaly.status === "assessed"));
    assert.ok(!JSON.stringify(bundle).includes("synthetic-key"));
    assert.equal(bundle.result.method.manifestId, bundle.manifest.id);
    const stages = researchStages(body).map((stage, index) => ({ stage, bundle: structuredClone([...stored.values()][index]) }));
    await assert.rejects(combineResearchStages(replacement, body, stages.slice(1)), /INVALID_RESPONSE/);
    // Explicit refresh re-fetches all four monthly snapshots.
    await submitResearch("staged-test", { ...body, areaId: replacement.id }, new AbortController().signal, { refresh: true });
    assert.equal(calls.length, 9);
    const lastComplete = metadata.get("pyro-last-research-v1");
    for (const fault of ["put", "history"]) {
      storageFailure = fault;
      await assert.rejects(submitResearch("staged-test", { ...body, areaId: replacement.id }, new AbortController().signal, { refresh: true }), error => error.code === "STORAGE_UNAVAILABLE");
      assert.equal(metadata.get("pyro-last-research-v1"), lastComplete, "failed storage must preserve the previous complete result");
    }
    storageFailure = undefined;
    abortFinal = new AbortController();
    await assert.rejects(submitResearch("staged-test", { ...body, areaId: replacement.id }, abortFinal.signal, { refresh: true }), error => error.name === "AbortError");
    assert.equal(metadata.get("pyro-last-research-v1"), lastComplete, "cancellation during final IndexedDB commit must preserve the selected result");
    abortFinal = undefined;
    storageFailure = "pyro-last-research-v1";
    await assert.rejects(openResearchResult(lastComplete), error => error.code === "STORAGE_UNAVAILABLE");
    storageFailure = "pyro-local-areas-v1";
    await assert.rejects(createResearchArea("staged-test", { requestId: crypto.randomUUID(), name: area.name, geometry: area.geometry }, new AbortController().signal), error => error.code === "STORAGE_UNAVAILABLE");
  } finally {
    globalThis.fetch = previous.fetch;
    globalThis.indexedDB = previous.db;
    globalThis.localStorage = previous.storage;
    if (previous.url === undefined) delete process.env.PIPELINE_URL; else process.env.PIPELINE_URL = previous.url;
    if (previous.data === undefined) delete process.env.RESEARCH_DATA_DIR; else process.env.RESEARCH_DATA_DIR = previous.data;
    lines.close(); server.kill(); await exited;
  }
});
