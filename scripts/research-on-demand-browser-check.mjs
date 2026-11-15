// Production Next route + Python HTTP fixture + real browser storage. NASA responses are synthetic.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, createWriteStream, writeFileSync, readFileSync } from "node:fs";
import { parse } from "csv-parse/sync";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

const output = resolve(".cache/verification-2026-11-15/browser");
mkdirSync(output, { recursive: true });
const base = `http://127.0.0.1:${Number(process.env.PYRO_BROWSER_PORT || 3109)}`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const children = [];
let browser;
let page;
const checks = [], exceptions = [], calls = [];
const startedAt = new Date().toISOString();
let buildId = null;
const writeReport = (status, error) => writeFileSync(`${output}/result.json`, JSON.stringify({
  status, passed: status === "passed", synthetic: true, startedAt,
  finishedAt: status === "running" ? null : new Date().toISOString(), buildId,
  checks, runtimeExceptions: exceptions, analysisRequests: calls.length, error,
}, null, 2));
writeReport("running");
const python = spawn(process.env.RESEARCH_PYTHON || "python", ["-u", "-c", [
  "from wsgiref.simple_server import make_server, WSGIRequestHandler",
  "from urllib.parse import urlparse",
  "import firms_on_demand",
  "from test_firms_on_demand import AVAILABLE, MODIS, VIIRS",
  "def fixture(url, timeout):",
  "    if 'data_availability' in url: return AVAILABLE",
  "    parts = urlparse(url).path.split('/')",
  "    modis = parts[-4] == 'MODIS_SP'",
  "    if parts[-1] == '2019-05-01': return (MODIS if modis else VIIRS).encode()",
  "    west, south, east, north = map(float, parts[-3].split(','))",
  "    row = str((south + north) / 2) + ',' + str((west + east) / 2) + ',300,' + parts[-1] + ',1230,' + ('T,90' if modis else 'N,n') + ',6.1,2,D\\n'",
  "    return ((MODIS if modis else VIIRS) + row).encode()",
  "firms_on_demand.download = fixture",
  "from app import app",
  "class Quiet(WSGIRequestHandler):",
  "    def log_message(self, *args): pass",
  "server = make_server('127.0.0.1', 0, app, handler_class=Quiet)",
  "print(server.server_port, flush=True)",
  "server.serve_forever()",
].join("\n")], { cwd: resolve("pipeline"), env: { ...process.env, RESEARCH_DATA_DIR: "", FIRMS_BLOB_BASE_URL: "", FIRMS_MAP_KEY: "synthetic-browser-key" }, stdio: ["ignore", "pipe", "pipe"] });
children.push(python);
python.stderr.pipe(createWriteStream(`${output}/python.log`));
try {
  buildId = readFileSync(".next/BUILD_ID", "utf8").trim();
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  const lines = createInterface({ input: python.stdout });
  const port = await Promise.race([once(lines, "line").then(([line]) => Number(line)), once(python, "exit").then(() => { throw Error("Python fixture failed to start"); })]);
  lines.close();
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", new URL(base).port], {
    env: { ...process.env, PIPELINE_URL: `http://127.0.0.1:${port}/`, FIRMS_MAP_KEY: "synthetic-browser-key", RESEARCH_DATA_DIR: "" }, stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(server);
  const log = createWriteStream(`${output}/next.log`);
  server.stdout.pipe(log); server.stderr.pipe(log);
  let ready = false;
  for (let attempt = 0; attempt < 200; attempt++) {
    if (server.exitCode !== null) throw Error("Next fixture server failed to start");
    try { ready = (await fetch(base)).ok; } catch {}
    if (ready) break;
    await pause(100);
  }
  assert.ok(ready, "production server must start");
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, timezoneId: "Asia/Jakarta", reducedMotion: "reduce" });
  await context.addInitScript(() => {
    if (localStorage.getItem("pyro-research-draft-v1")) return;
    localStorage.setItem("pyro-language", "en");
    localStorage.setItem("pyro-research-draft-v1", JSON.stringify({ name: "Synthetic staged Amazon", start: "2019-01-30", end: "2019-02-02", compare: true, compareStart: "2018-03-31", compareEnd: "2018-04-01", years: 10, policy: "quality-policy-1", vertices: [[-61,-10],[-60.9,-10],[-60.9,-9.9]] }));
  });
  // Basemap availability and live recent hotspots are outside this deterministic acceptance.
  await context.route("https://**/*", route => route.abort());
  await context.route("**/api/hotspots**", route => route.fulfill({ status: 503, json: { code: "DEPENDENCY_UNAVAILABLE" } }));
  let mode = "fail-second", held, release;
  await context.route("**/api/local-research", async route => {
    const body = route.request().postDataJSON();
    if (body.action !== "analyze") return route.continue();
    calls.push({ period: body.request.period, baseline: body.includeBaseline });
    if (mode === "network-error") return route.fulfill({ status: 503, json: { code: "NETWORK_ERROR" } });
    if (mode === "not-configured") return route.fulfill({ status: 503, json: { code: "NOT_CONFIGURED" } });
    if (mode === "fail-second" && calls.length === 2) return route.fulfill({ status: 503, json: { code: "DEPENDENCY_UNAVAILABLE" } });
    if (["hold-second", "hold-success"].includes(mode) && calls.length === held) {
      const continueAfterHold = mode === "hold-success";
      await new Promise(resolve => { release = resolve; });
      if (continueAfterHold) return route.continue().catch(() => {});
      return route.abort().catch(() => {});
    }
    return route.continue();
  });
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", error => exceptions.push(error.message));
  const open = async () => {
    await page.goto(`${base}/simulation`);
    await page.getByRole("button", { name: "Historical analysis", exact: true }).click();
    await page.getByRole("button", { name: "Analyze area", exact: true }).waitFor();
    await page.waitForFunction(() => ![...document.querySelectorAll("button")].find(node => node.textContent.trim() === "Analyze area")?.disabled);
  };
  const analyze = () => page.getByRole("button", { name: "Analyze area", exact: true }).click();
  const done = () => page.getByRole("status").filter({ hasText: "Analysis completed" }).waitFor();
  const expand = async selector => {
    const detail = page.locator(selector);
    if (!await detail.evaluate(node => node.open)) await detail.locator("summary").first().click();
  };
  const refresh = async checked => {
    await expand(".research-refresh");
    await page.getByLabel("Fetch saved parts again from NASA", { exact: true }).setChecked(checked);
  };
  const storedId = () => page.evaluate(() => localStorage.getItem("pyro-last-research-v1"));
  const progress = () => page.locator("table").filter({ has: page.locator("caption", { hasText: "Calendar loading" }) });
  await open();
  await analyze();
  await page.getByRole("status").filter({ hasText: "Analysis failed" }).waitFor();
  assert.match(await progress().innerText(), /Saved/);
  assert.match(await progress().innerText(), /Not loaded/);
  assert.equal(await storedId(), null);
  checks.push("failure retains first month without publishing incomplete result");
  mode = "pass";
  await open();
  await analyze(); await done();
  assert.equal(calls.length, 5, "reload resumes only the three remaining months");
  assert.equal(await page.locator(".calendar-cell").count(), 2);
  const resultView = page.getByRole("region", { name: "Analysis result", exact: true });
  assert.equal(await resultView.getByRole("heading", { name: "Analysis result", exact: true }).evaluate(node => node === document.activeElement), true);
  assert.equal(await page.locator(".research-downloads").evaluate(node => node.open), false);
  assert.equal(await page.locator(".research-followup").evaluate(node => node.open), false);
  await resultView.getByRole("heading", { name: "4 satellite detections recorded", exact: true }).waitFor();
  await resultView.screenshot({ path: `${output}/results-desktop.png` });
  await page.locator(".calendar-cell").first().focus();
  await page.keyboard.press("Enter");
  const daily = resultView.getByRole("region", { name: "Daily detail", exact: true });
  await daily.waitFor();
  assert.equal(await page.locator('.calendar-cell[aria-pressed="true"]').count(), 1);
  assert.ok(await daily.evaluate(node => node.compareDocumentPosition(document.querySelector(".research-comparison")) & Node.DOCUMENT_POSITION_FOLLOWING));
  await resultView.screenshot({ path: `${output}/results-daily-desktop.png` });
  await page.getByRole("button", { name: "Show all months", exact: true }).click();
  await daily.waitFor({ state: "hidden" });
  assert.equal(await page.locator('.calendar-cell[aria-pressed="true"]').count(), 0);
  assert.equal(await page.locator(".calendar-cell").first().evaluate(node => node === document.activeElement), true);
  checks.push("new results receive focus, explain counts, keep secondary tools collapsed and support keyboard daily drill-down");
  const downloadBundle = async () => {
    await expand(".research-downloads");
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "JSON + manifest", exact: true }).click();
    const download = await pending;
    const chunks = [];
    for await (const chunk of await download.createReadStream()) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString());
  };
  const bundle = await downloadBundle();
  await open();
  await page.getByRole("region", { name: "Analysis result", exact: true }).getByText(/Synthetic staged Amazon/).waitFor();
  checks.push("complete saved results restore after reload and local index recovery");
  await expand(".research-followup");
  await page.getByRole("button", { name: "View detection", exact: true }).first().waitFor();
  checks.push("first page of original points loads automatically after analysis");
  assert.equal(bundle.manifest.stages.length, 4);
  assert.equal(bundle.result.primary.days, 4);
  assert.equal(bundle.result.comparison.days, 2);
  assert.equal(bundle.result.primary.metric.rawCount, 4);
  const persisted = await page.evaluate(id => new Promise((resolve, reject) => {
    const request = indexedDB.open("pyro-research-v1", 1);
    request.onerror = () => reject(Error("Cannot open stored bundle"));
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction("results").objectStore("results").get(id);
      read.onsuccess = () => { resolve(read.result); db.close(); };
      read.onerror = () => { reject(Error("Cannot read stored bundle")); db.close(); };
    };
  }), bundle.result.id);
  assert.ok(persisted.days.every(page => page.analysisId === bundle.result.id));
  assert.equal(bundle.manifest.stages[2].manifest.snapshot.baselineRequested, false);
  assert.ok(!JSON.stringify(bundle).includes("synthetic-browser-key"));
  checks.push("real IndexedDB reload/resume, comparison and combined JSON provenance");
  for (const name of ["Original detections CSV", "Aggregate CSV", "Calendar PNG"]) {
    await expand(".research-downloads");
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name, exact: true }).click();
    const download = await pending;
    const path = `${output}/${download.suggestedFilename()}`;
    await download.saveAs(path);
    const bytes = readFileSync(path);
    if (name === "Original detections CSV") {
      const rows = parse(bytes, { columns: true });
      assert.equal(rows.length, bundle.result.primary.metric.rawCount);
      assert.ok(rows.every(row => row.recordType === "observation" && row.analysisId === bundle.result.id));
    }
    if (name === "Aggregate CSV") assert.ok(parse(bytes, { columns: true }).length >= 3);
    if (name === "Calendar PNG") assert.equal(bytes.subarray(1, 4).toString(), "PNG");
  }
  checks.push("original CSV, aggregate CSV and calendar PNG downloads");
  await refresh(true);
  await analyze(); await done();
  assert.equal(calls.length, 9, "refresh must fetch all four months");
  checks.push("explicit refresh refetches every stage");
  const beforeCancel = await storedId();
  await page.getByLabel("Compare another period", { exact: true }).uncheck();
  await page.getByLabel("Start (UTC)", { exact: true }).fill("2019-05-30");
  await page.getByLabel("End (UTC, inclusive)", { exact: true }).fill("2019-06-02");
  await refresh(false);
  mode = "hold-second"; held = calls.length + 2;
  await analyze();
  await page.waitForFunction(() => [...document.querySelectorAll("caption")].some(node => node.textContent.includes("Calendar loading")));
  for (let attempt = 0; !release && attempt < 150; attempt++) await pause(100);
  assert.ok(release, "second request must be in flight before cancellation");
  await page.getByRole("button", { name: "Stop monitoring", exact: true }).click();
  assert.doesNotMatch(await progress().innerText(), /Loading…/);
  assert.match(await progress().innerText(), /Failed \/ stopped/);
  assert.equal(await storedId(), beforeCancel);
  release(); mode = "pass";
  const beforeResume = calls.length;
  await open(); await analyze(); await done();
  assert.equal(calls.length, beforeResume + 1);
  checks.push("cancel clears loading state, preserves old result and resumes after reload");
  const previousComplete = await storedId();
  await page.evaluate(() => { IDBObjectStore.prototype.put = () => { throw new DOMException("Synthetic full storage", "QuotaExceededError"); }; });
  await refresh(true);
  await analyze();
  await page.getByRole("alert").filter({ hasText: "storage" }).waitFor();
  assert.equal(await storedId(), previousComplete);
  checks.push("IndexedDB quota error is visible and preserves complete result");
  await open();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === "pyro-research-history-v1") throw new DOMException("Synthetic full storage", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await refresh(true);
  await analyze();
  await page.getByRole("alert").filter({ hasText: "storage" }).waitFor();
  assert.equal(await storedId(), previousComplete);
  checks.push("localStorage history quota error is visible and preserves complete result");
  // Reload clears injected storage failures before testing the connected product views.
  await open();
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  const workspace = page.getByRole("region", { name: "Saved analysis workspace", exact: true });
  await workspace.getByRole("heading", { name: /Synthetic staged Amazon/ }).waitFor();
  assert.match(await workspace.locator(".metrics").innerText(), /Original detections/);
  assert.equal(await workspace.getByRole("button", { name: "JSON + manifest", exact: true }).count(), 1);
  await page.getByRole("button", { name: "Sensor comparison", exact: true }).click();
  await workspace.getByRole("table").filter({ has: page.locator("caption", { hasText: "Original detections by source" }) }).waitFor();
  checks.push("dashboard and sensor comparison read the actual saved backend result");
  await page.getByRole("button", { name: "Field reports", exact: true }).click();
  const monitoring = workspace.getByRole("region", { name: "Monitoring locations", exact: true });
  await monitoring.getByRole("button", { name: "View detection", exact: true }).first().click();
  await monitoring.getByLabel("Location name", { exact: true }).fill("Integrated field site");
  await monitoring.getByLabel("Marked by (local name)", { exact: true }).fill("Researcher");
  await monitoring.getByRole("button", { name: "Save location", exact: true }).click();
  await monitoring.getByText("Location saved with its original evidence.", { exact: true }).waitFor();
  await monitoring.getByLabel("Assignee", { exact: true }).fill("Inspector");
  await monitoring.getByLabel("Assignment recorder", { exact: true }).fill("Coordinator");
  await monitoring.getByRole("button", { name: "Create assignment", exact: true }).click();
  await monitoring.getByRole("heading", { name: "Record inspection", exact: true }).waitFor();
  await monitoring.getByLabel("Recorder", { exact: true }).fill("Recorder");
  await monitoring.getByLabel("Inspection time (local time)", { exact: true }).fill("2020-01-01T08:00");
  await monitoring.getByLabel("Notes", { exact: true }).fill("Integrated field inspection");
  await monitoring.getByRole("button", { name: "Save inspection", exact: true }).click();
  await monitoring.getByText("Integrated field inspection", { exact: true }).waitFor();
  await monitoring.getByRole("button", { name: "Correct report", exact: true }).click();
  await monitoring.getByLabel("Notes", { exact: true }).fill("Corrected field inspection");
  await monitoring.getByLabel("Recorder", { exact: true }).fill("Editor");
  await monitoring.getByLabel("Correction reason", { exact: true }).fill("Clarified findings");
  await monitoring.getByRole("button", { name: "Save inspection", exact: true }).click();
  await monitoring.getByText("Corrected field inspection", { exact: true }).waitFor();
  await monitoring.getByRole("combobox", { name: "Task status", exact: true }).selectOption("completed");
  await monitoring.getByLabel("Changed by", { exact: true }).fill("Coordinator");
  await monitoring.getByRole("button", { name: "Update status", exact: true }).click();
  await monitoring.getByRole("combobox", { name: "Task status", exact: true }).waitFor({ state: "detached" });
  await page.reload();
  await page.getByRole("button", { name: "Field reports", exact: true }).click();
  await monitoring.getByRole("combobox", { name: "Saved locations", exact: true }).selectOption({ label: "RESEARCH · Integrated field site" });
  await monitoring.getByRole("combobox", { name: "Choose assignment", exact: true }).selectOption({ index: 1 });
  await monitoring.getByText("Corrected field inspection", { exact: true }).waitFor();
  assert.equal(await monitoring.getByRole("combobox", { name: "Task status", exact: true }).count(), 0);
  checks.push("field reports share original evidence, assignment, correction history and terminal status after reload");
  await monitoring.getByRole("button", { name: "Use area for follow-up analysis", exact: true }).click();
  assert.equal(await page.getByLabel("Area name", { exact: true }).inputValue(), "Synthetic staged Amazon");
  checks.push("field report follow-up opens the historical workspace with the saved polygon");
  await page.getByText("Polygon coordinate editor", { exact: true }).click();
  await page.getByRole("textbox", { name: "Longitude, latitude", exact: true }).fill("113,-3\n113.1,-3\n113.1,-2.9");
  await page.getByRole("button", { name: "Use coordinates as draft", exact: true }).click();
  await page.getByRole("button", { name: "Use this area", exact: true }).first().click();
  await page.getByLabel("Area name", { exact: true }).fill("Unsupported Kalteng test");
  await page.getByLabel("Start (UTC)", { exact: true }).fill("2019-01-01");
  await page.getByLabel("End (UTC, inclusive)", { exact: true }).fill("2019-01-01");
  await page.getByLabel("Compare another period", { exact: true }).uncheck();
  await analyze(); await done();
  assert.match(await page.locator(".calendar-cell").innerText(), /^2\s/);
  await expand(".research-followup");
  await page.getByRole("button", { name: "View detection", exact: true }).first().waitFor();
  const unsupported = await downloadBundle();
  assert.equal(unsupported.result.primary.metric.harmonizedCount, null);
  assert.equal(unsupported.result.primary.metric.rawCount, 2);
  checks.push("polygon apply and analysis show raw detections even when Kalteng estimates are unsupported");
  await page.getByLabel("Start (UTC)", { exact: true }).fill("2019-05-01");
  await page.getByLabel("End (UTC, inclusive)", { exact: true }).fill("2019-05-01");
  await analyze(); await done();
  await resultView.getByRole("heading", { name: "No detections in available coverage", exact: true }).waitFor();
  assert.match(await page.locator(".calendar-cell").innerText(), /^0\b/);
  await resultView.getByText("All covered months have zero detections.", { exact: true }).waitFor();
  await resultView.screenshot({ path: `${output}/results-zero.png` });
  await resultView.getByRole("button", { name: "Anomaly", exact: true }).click();
  await resultView.getByText("No values available for this view.", { exact: true }).waitFor();
  assert.match(await page.locator(".calendar-cell").innerText(), /^-/);
  checks.push("successful empty NASA responses show zero detections while unavailable anomaly values remain missing");
  await page.getByLabel("Start (UTC)", { exact: true }).fill("2000-01-01");
  await page.getByLabel("End (UTC, inclusive)", { exact: true }).fill("2000-01-01");
  await analyze(); await done();
  await page.getByText(/The historical sources have no coverage/).waitFor();
  await page.getByText(/2000-11-01 → 2025-12-31/).first().waitFor();
  assert.match(await page.locator(".calendar-cell").innerText(), /^-/);
  await resultView.screenshot({ path: `${output}/results-no-coverage.png` });
  checks.push("unavailable dates show missing coverage and actual NASA availability instead of zero");
  const beforeNetworkFailure = await storedId();
  mode = "network-error";
  await page.getByLabel("Start (UTC)", { exact: true }).fill("2019-01-01");
  await page.getByLabel("End (UTC, inclusive)", { exact: true }).fill("2019-01-01");
  await refresh(true);
  await analyze();
  await page.getByRole("alert").filter({ hasText: "Connection to the historical service or NASA failed" }).waitFor();
  assert.equal(await storedId(), beforeNetworkFailure);
  checks.push("NASA connectivity error is visible and preserves the previous complete result");
  mode = "not-configured";
  await analyze(); await page.getByText(/historical source is not ready or its archive is empty/).waitFor();
  assert.equal(await storedId(), beforeNetworkFailure);
  checks.push("empty archive configuration failure is distinct from missing coverage and preserves the previous result");
  await page.evaluate(() => {
    const original = window.fetch;
    window.researchSelectionAborted = false;
    window.fetch = function(input, options) {
      if (input === "/api/local-research" && JSON.parse(options.body).action === "analyze") {
        options.signal.addEventListener("abort", () => { window.researchSelectionAborted = true; }, { once: true });
      }
      return original.call(this, input, options);
    };
  });
  await page.getByLabel("Start (UTC)", { exact: true }).fill("2019-04-01");
  await page.getByLabel("End (UTC, inclusive)", { exact: true }).fill("2019-04-01");
  mode = "hold-success"; held = calls.length + 1; release = undefined;
  await analyze();
  for (let attempt = 0; !release && attempt < 150; attempt++) await pause(100);
  assert.ok(release, "request must be in flight before selecting another saved result");
  await page.getByRole("button", { name: "Dashboard", exact: true }).click();
  await workspace.getByRole("combobox", { name: "Analysis result", exact: true }).selectOption(bundle.result.id);
  await workspace.getByRole("heading", { name: /Synthetic staged Amazon/ }).waitFor();
  release(); mode = "pass";
  await page.waitForFunction(() => window.researchSelectionAborted === true);
  await page.getByRole("button", { name: "Historical research", exact: true }).click();
  assert.equal(await storedId(), bundle.result.id);
  await page.getByRole("region", { name: "Analysis result", exact: true }).getByText(/Synthetic staged Amazon/).waitFor();
  checks.push("selecting a saved dashboard result cancels the hidden analysis and preserves the user's selection");
  await open();
  const beforeFinalWrite = await storedId();
  const historyBeforeFinalWrite = await page.evaluate(() => localStorage.getItem("pyro-research-history-v1"));
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, ...args) {
      const request = original.call(this, value, ...args);
      if (value?.result?.id.startsWith("staged-")) this.transaction.addEventListener("complete", () => {
        [...document.querySelectorAll("button")].find(node => node.textContent.trim() === "Stop monitoring")?.click();
      }, { once: true });
      return request;
    };
  });
  await page.getByLabel("Start (UTC)", { exact: true }).fill("2019-07-01");
  await page.getByLabel("End (UTC, inclusive)", { exact: true }).fill("2019-07-01");
  await analyze();
  await page.getByRole("status").filter({ hasText: "Loading stopped" }).waitFor();
  assert.equal(await storedId(), beforeFinalWrite);
  assert.equal(await page.evaluate(() => localStorage.getItem("pyro-research-history-v1")), historyBeforeFinalWrite);
  checks.push("cancellation during the final IndexedDB commit preserves the selected result and history");
  await open();
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === "pyro-local-areas-v1") throw new DOMException("Synthetic full storage", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await analyze();
  await page.getByRole("alert").filter({ hasText: "storage" }).waitFor();
  assert.equal(await storedId(), beforeFinalWrite);
  checks.push("area metadata quota failures show a storage error and preserve the previous result");
  await open();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".language-switch select").selectOption("id");
  await page.getByRole("button", { name: "Analisis area", exact: true }).waitFor();
  assert.equal(await page.locator(".research-source-counts > div").evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth + 1 && node.querySelector("dt").getBoundingClientRect().bottom <= node.querySelector("dd").getBoundingClientRect().top + 1)), true);
  assert.equal(await page.locator(".calendar-cell").evaluateAll(nodes => nodes.every(node => node.scrollWidth <= node.clientWidth + 1)), true);
  checks.push("mobile source counts and calendar values fit without clipping or overlapping");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(await page.locator(".profile").count(), 0);
  const navigationToggle = page.getByRole("button", { name: "Buka/tutup navigasi", exact: true });
  await navigationToggle.click();
  const closeNavigation = page.getByRole("button", { name: "Tutup menu", exact: true });
  await closeNavigation.waitFor();
  assert.equal(await closeNavigation.evaluate(node => node === document.activeElement), true);
  assert.equal(await page.locator("main").evaluate(node => node.inert), true);
  await page.locator(".sidebar-source").focus();
  await page.keyboard.press("Tab");
  assert.equal(await page.locator(".sidebar .brand").evaluate(node => node === document.activeElement), true);
  await page.keyboard.press("Escape");
  await closeNavigation.waitFor({ state: "hidden" });
  assert.equal(await navigationToggle.evaluate(node => node === document.activeElement), true);
  assert.equal(await page.locator("main").evaluate(node => node.inert), false);
  checks.push("account-free mobile navigation keeps focus in the drawer and restores access after Escape");
  await page.screenshot({ path: `${output}/mobile-id.png`, fullPage: true });
  const mobileResult = page.getByRole("region", { name: "Hasil analisis", exact: true });
  await mobileResult.screenshot({ path: `${output}/results-mobile-id.png` });
  await mobileResult.getByRole("heading", { name: "Hasil analisis", exact: true }).scrollIntoViewIfNeeded();
  writeFileSync(`${output}/results-mobile-layout.json`, JSON.stringify(await page.evaluate(() => {
    const link = document.querySelector(".skip-link");
    return { skipLinkFocused: link === document.activeElement, skipLinkTop: getComputedStyle(link).top, skipLinkViewportTop: link.getBoundingClientRect().top, viewport: innerWidth, pageWidth: document.documentElement.scrollWidth };
  }), null, 2));
  await page.screenshot({ path: `${output}/results-mobile-viewport.png` });
  checks.push("Indonesian labels and mobile viewport without page overflow");
  assert.deepEqual(exceptions, []);
  writeReport("passed");
  console.log(JSON.stringify({ passed: true, synthetic: true, checks, analysisRequests: calls.length }, null, 2));
  await context.close();
} catch (error) {
  writeReport("failed", error.message);
  if (page && !page.isClosed()) {
    writeFileSync(`${output}/failure.html`, await page.content());
    await page.screenshot({ path: `${output}/failure.png`, fullPage: true });
    const overflow = await page.evaluate(() => [...document.querySelectorAll("body *")].filter(node => {
      const rect = node.getBoundingClientRect();
      return rect.width && (rect.right > innerWidth + 1 || rect.left < -1);
    }).slice(0, 25).map(node => ({ tag: node.tagName, class: node.className, text: node.textContent.slice(0, 100), width: node.getBoundingClientRect().width })));
    writeFileSync(`${output}/failure.json`, JSON.stringify({ error: error.message, checks, overflow }, null, 2));
  }
  throw error;
} finally {
  await browser?.close();
  for (const child of children.reverse()) {
    if (child.exitCode !== null) continue;
    const exited = once(child, "exit");
    child.kill();
    await exited;
  }
}
