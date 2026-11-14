// Playwright MCP browser_run_code_unsafe filename. Synthetic UI benchmark, not archive processing.
async (parent) => {
  const out = "D:/NASA/.cache/sprint3-acceptance";
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const results = [];
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    const context = await parent.context().browser().newContext({ viewport, timezoneId: "Asia/Jakarta", reducedMotion: "reduce", acceptDownloads: true });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const exceptions = [], writes = [];
    page.on("pageerror", error => exceptions.push(error.message));
    page.on("request", request => { if (request.method() === "POST") writes.push(request.url()); });
    try {
      await page.goto("http://localhost:3005/simulation");
      await page.getByRole("button", { name: "Analisis historis", exact: true }).click();
      await page.getByRole("button", { name: "Lihat contoh sintetis", exact: true }).click();
      const downloading = page.waitForEvent("download");
      await page.getByRole("button", { name: "JSON + manifest", exact: true }).click();
      const download = await downloading;
      let json = "";
      for await (const chunk of await download.createReadStream()) json += chunk.toString();
      const base = JSON.parse(json).result;
      const size = 20000;
      const bundle = structuredClone({ result: base, manifest: { synthetic: true, benchmark: true }, days: [], detections: [] });
      const result = bundle.result;
      result.id = `benchmark-synthetic-${viewport.width}`;
      result.jobId = `job-${result.id}`;
      result.area.name = "Synthetic benchmark / " + "Nama wilayah panjang — long research area name ".repeat(3);
      const vertices = Array.from({ length: 500 }, (_, i) => {
        const angle = 2 * Math.PI * i / 500;
        return [+(114 + 0.8 * Math.cos(angle)).toFixed(6), +(-2.5 + 0.8 * Math.sin(angle)).toFixed(6)];
      });
      result.area.geometry.coordinates = [[...vertices, vertices[0]]];
      result.comparison = null;
      result.primary.period = { start: "2000-01-01", end: "2025-12-31" };
      result.primary.days = (Date.parse("2026-01-01") - Date.parse("2000-01-01")) / 86400000;
      result.baseline.minimumValidYears = 4;
      for (const source of result.sources) { source.observedFrom = "2000-01-01T00:00:00.000Z"; source.observedTo = "2025-12-31T23:59:00.000Z"; }
      const observations = Array.from({ length: size }, (_, i) => {
        const monthIndex = i % 312;
        const month = `${2000 + Math.floor(monthIndex / 12)}-${String(monthIndex % 12 + 1).padStart(2, "0")}`;
        return { id: `synthetic-${i}`, sourceId: "VIIRS_SNPP_SP", observedAt: `${month}-15T00:00:00.000Z`, coordinates: [114 + (i % 100) / 1000, -2.5 + Math.floor(i / 100) / 1000], confidence: "n", frpMw: null };
      });
      const metric = count => ({ rawCount: count, rawCountsBySource: { MODIS_SP: 0, VIIRS_SNPP_SP: count }, harmonizedCount: count / 4, status: "available" });
      result.primary.metric = metric(size);
      result.months = Array.from({ length: 312 }, (_, index) => {
        const year = 2000 + Math.floor(index / 12), month = `${year}-${String(index % 12 + 1).padStart(2, "0")}`;
        return { month, metric: metric(Math.floor(size / 312) + (index < size % 312 ? 1 : 0)), anomaly: { status: "insufficient_history", referenceYears: [], baselineStatistic: null, baselineValue: null, delta: null, scoreKind: null, score: null }, isPartialPeriod: false };
      });
      for (let index = 0; index < size; index += 1000) bundle.detections.push({ schemaVersion: "research-2", analysisId: result.id, periodRole: "primary", observations: observations.slice(index, index + 1000), nextCursor: index + 1000 < size ? String(index + 1000) : null });
      await page.evaluate(async ({ bundle, vertices }) => {
        await new Promise((resolve, reject) => {
          const request = indexedDB.open("pyro-research-v1", 1);
          request.onupgradeneeded = () => request.result.createObjectStore("results", { keyPath: "result.id" });
          request.onsuccess = () => {
            const db = request.result, tx = db.transaction("results", "readwrite");
            tx.objectStore("results").put(bundle);
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = reject;
          };
        });
        localStorage.setItem("pyro-last-research-v1", bundle.result.id);
        localStorage.setItem("pyro-research-draft-v1", JSON.stringify({ name: bundle.result.area.name, start: "2025-08-01", end: "2025-08-31", years: 10, policy: "quality-policy-1", vertices }));
      }, { bundle, vertices });
      const metadata = await page.evaluate(() => ({ userAgent: navigator.userAgent, cores: navigator.hardwareConcurrency, deviceMemoryGiB: navigator.deviceMemory ?? null, devicePixelRatio, reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches, network: "no throttling; imagery network uncontrolled; localhost application" }));
      const started = Date.now();
      await page.reload();
      await page.getByRole("button", { name: "Analisis historis", exact: true }).click();
      await page.locator(".calendar-cell").last().waitFor();
      const restoreMs = Date.now() - started;
      check(await page.locator(".calendar-cell").count() === 312, "Every month must remain present");
      const pageLoadMs = [];
      await page.evaluate(() => {
        window.__bundleReads = 0;
        const get = IDBObjectStore.prototype.get;
        IDBObjectStore.prototype.get = function(...args) { if (this.name === "results") window.__bundleReads++; return get.apply(this, args); };
      });
      for (let index = 0; index < size / 1000; index++) {
        const button = page.getByRole("button", { name: index ? "Muat halaman titik berikutnya" : "Muat titik mentah hasil", exact: true });
        const start = Date.now();
        await button.click();
        await page.locator(".research-results p[role=status]").filter({ hasText: `${(index + 1) * 1000} titik dimuat` }).waitFor();
        pageLoadMs.push(Date.now() - start);
      }
      const canvas = page.locator("canvas.maplibregl-canvas");
      const sameCanvas = await canvas.elementHandle();
      await page.evaluate(() => {
        window.__sprint3 = { frames: [], tasks: [], previous: null, running: true };
        const frame = now => { const data = window.__sprint3; if (data.previous !== null) data.frames.push(now - data.previous); data.previous = now; if (data.running) requestAnimationFrame(frame); };
        requestAnimationFrame(frame);
        try { const observer = new PerformanceObserver(list => window.__sprint3.tasks.push(...list.getEntries().map(entry => entry.duration))); observer.observe({ entryTypes: ["longtask"] }); window.__sprint3.observer = observer; } catch {}
      });
      const toggleMs = [];
      for (let index = 0; index < 3; index++) {
        const start = Date.now();
        await page.getByRole("button", { name: index % 2 ? "Kepadatan hotspot" : "Titik hotspot", exact: true }).click();
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        toggleMs.push(Date.now() - start);
      }
      await canvas.scrollIntoViewIfNeeded();
      const box = await canvas.boundingBox();
      await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6);
      await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.55, { steps: 10 }); await page.mouse.up();
      await page.mouse.wheel(0, -300);
      await page.waitForTimeout(500);
      const samples = await page.evaluate(() => { const data = window.__sprint3; data.running = false; data.observer?.disconnect(); return { frameGapsMs: data.frames, longTasksMs: data.tasks, heapBytes: performance.memory?.usedJSHeapSize ?? null }; });
      check(await canvas.evaluate((node, previous) => node === previous, sameCanvas), "Pan/toggle must preserve the map canvas");
      const beforeWrites = writes.length;
      await page.getByLabel("Mulai (UTC)", { exact: true }).fill("2024-08-01");
      check(writes.length === beforeWrites && writes.length === 0, "Navigation and period editing must not submit analysis");
      check(await page.locator(".calendar-cell").count() === 312, "Editing a period must preserve the previous result");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      const bundleReadsWhilePaging = await page.evaluate(() => window.__bundleReads);
      const unnamed = await page.locator('.research-results button, .research-monitoring button').evaluateAll(nodes => nodes.filter(node => !node.textContent.trim() && !node.getAttribute("aria-label")).length);
      await page.locator(".calendar-cell").first().focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Shift+Tab");
      const focus = await page.locator(".calendar-cell").first().evaluate(node => ({ focused: document.activeElement === node, visible: node.matches(":focus-visible"), outline: getComputedStyle(node).outlineStyle, width: getComputedStyle(node).outlineWidth }));
      check(!overflow && unnamed === 0 && focus.focused && focus.visible && focus.outline !== "none" && Number.parseFloat(focus.width) > 0, "Overflow, button labels and keyboard focus checks");
      await page.locator(".research-results").screenshot({ path: `${out}/dense-${viewport.width}.png` });
      await page.locator(".research-results h2").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${out}/dense-top-${viewport.width}.png` });
      if (viewport.width === 1440) {
        await page.setViewportSize({ width: 720, height: 500 });
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Reflow at half desktop CSS width (200% zoom equivalent)");
      }
      check(exceptions.length === 0, exceptions.join("; "));
      results.push({ viewport, emulatedMobile: viewport.width === 390, metadata, points: size, vertices: 500, calendarMonths: 312, restoreMs, pageLoadMs, toggleMs, ...samples, bundleReadsWhilePaging, noAnalysisWrites: writes.length === 0, canvasPreserved: true, overflow, unnamedButtons: unnamed, focus, runtimeExceptions: exceptions });
    } catch (error) { await page.screenshot({ path: `${out}/failure-${viewport.width}.png`, fullPage: true }); throw error; }
    finally { await context.close(); }
  }
  return { synthetic: true, disclaimer: "Timings include Playwright and browser IPC; viewport emulation is not a physical mobile benchmark. Frame gaps are samples, not a sustained FPS claim.", results };
}
