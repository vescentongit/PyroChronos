// Playwright MCP browser_run_code_unsafe filename. Synthetic accessibility/edge-state checks.
async (parent) => {
  const out = "D:/NASA/.cache/sprint3-acceptance";
  const checks = [];
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const context = await parent.context().browser().newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce", timezoneId: "Asia/Jakarta", acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const exceptions = [];
  page.on("pageerror", error => exceptions.push(error.message));
  try {
    await page.goto("http://localhost:3005/simulation");
    await page.getByRole("button", { name: "Analisis historis", exact: true }).click();
    await page.getByRole("button", { name: "Lihat contoh sintetis", exact: true }).click();
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "JSON + manifest", exact: true }).click();
    let text = "";
    for await (const chunk of await (await pending).createReadStream()) text += chunk.toString();
    const base = JSON.parse(text).result;
    for (const scenario of ["no_data", "method_unsupported", "partial", "fractional"]) {
      const result = structuredClone(base);
      result.id = `synthetic-edge-${scenario}`;
      result.area.name = "Synthetic / " + "Nama wilayah yang panjang untuk uji aksesibilitas ".repeat(3);
      result.comparison = scenario === "partial" ? result.comparison : null;
      const metric = scenario === "no_data"
        ? { rawCount: null, rawCountsBySource: { MODIS_SP: null, VIIRS_SNPP_SP: null }, harmonizedCount: null, status: scenario }
        : scenario === "partial"
          ? { rawCount: 0, rawCountsBySource: { MODIS_SP: null, VIIRS_SNPP_SP: 0 }, harmonizedCount: 0, status: scenario }
          : scenario === "fractional"
            ? { rawCount: 1, rawCountsBySource: { MODIS_SP: 0, VIIRS_SNPP_SP: 1 }, harmonizedCount: 0.25, status: "available" }
            : { rawCount: 0, rawCountsBySource: { MODIS_SP: 0, VIIRS_SNPP_SP: 0 }, harmonizedCount: null, status: scenario };
      result.primary.metric = structuredClone(metric);
      result.months[0].metric = structuredClone(metric);
      result.months[0].isPartialPeriod = scenario === "partial";
      result.months[0].anomaly = { status: scenario === "no_data" ? "insufficient_data" : scenario === "partial" ? "insufficient_history" : "method_unsupported", referenceYears: scenario === "partial" ? [2025] : [], baselineStatistic: null, baselineValue: null, delta: null, scoreKind: null, score: null };
      if (result.comparison) result.comparison.metric = { rawCount: 0, rawCountsBySource: { MODIS_SP: 0, VIIRS_SNPP_SP: 0 }, harmonizedCount: 0, status: "available" };
      if (scenario === "method_unsupported") result.method.validation = "unsupported";
      const days = Array.from({ length: 31 }, (_, i) => ({ date: `2026-08-${String(i + 1).padStart(2, "0")}`, metric: scenario === "fractional" && i > 0 ? { rawCount: 0, rawCountsBySource: { MODIS_SP: 0, VIIRS_SNPP_SP: 0 }, harmonizedCount: 0, status: "available" } : structuredClone(metric), anomaly: structuredClone(result.months[0].anomaly) }));
      const observations = scenario === "fractional" ? [{ id: "synthetic-fractional-point", sourceId: "VIIRS_SNPP_SP", observedAt: "2026-08-01T00:00:00.000Z", coordinates: [114, -2.5], confidence: "n", frpMw: null }] : [];
      const bundle = { result, manifest: { synthetic: true, scenario }, days: [{ schemaVersion: "research-2", analysisId: result.id, periodRole: "primary", month: "2026-08", days, nextCursor: null }], detections: [{ schemaVersion: "research-2", analysisId: result.id, periodRole: "primary", observations, nextCursor: null }] };
      await page.evaluate(async bundle => {
        await new Promise((resolve, reject) => {
          const request = indexedDB.open("pyro-research-v1", 1);
          request.onupgradeneeded = () => request.result.createObjectStore("results", { keyPath: "result.id" });
          request.onsuccess = () => { const db = request.result, tx = db.transaction("results", "readwrite"); tx.objectStore("results").put(bundle); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = reject; };
        });
        localStorage.setItem("pyro-last-research-v1", bundle.result.id);
      }, bundle);
      await page.reload();
      await page.getByRole("button", { name: /^(Analisis historis|Historical analysis)$/ }).click();
      await page.locator(".calendar-cell").waitFor();
      for (const language of ["id", "en"]) {
        await page.getByRole("combobox", { name: /Bahasa|Language/, exact: true }).selectOption(language);
        const label = await page.locator(".calendar-cell").innerText();
        check(scenario === "fractional" ? /0[,.]25/.test(label) : scenario === "partial" ? label.includes("0") : label.includes("—"), `${scenario} must distinguish zero/missing/fractional`);
        if (scenario === "fractional") check(await page.locator(".calendar-cell").evaluate(node => getComputedStyle(node).backgroundColor) === "rgb(25, 51, 87)", "A fractional maximum must reach the darkest count endpoint");
        await page.locator(".calendar-cell").focus();
        await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab");
        const focus = await page.locator(".calendar-cell").evaluate(node => ({ active: document.activeElement === node, visible: node.matches(":focus-visible"), width: getComputedStyle(node).outlineWidth }));
        check(focus.active && focus.visible && Number.parseFloat(focus.width) > 0, `Visible keyboard focus: ${JSON.stringify(focus)}`);
        await page.keyboard.press("Enter");
        await page.locator(".research-results details[open]").last().waitFor();
        await page.getByRole("button", { name: language === "id" ? "Anomali" : "Anomaly", exact: true }).click();
        check((await page.locator(".calendar-cell").innerText()).includes("—"), "Insufficient/unsupported anomaly must remain unknown");
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Long names must not overflow");
        const rawPending = page.waitForEvent("download");
        await page.getByRole("button", { name: language === "id" ? "CSV deteksi asli" : "Original detections CSV", exact: true }).click();
        let csv = "";
        for await (const chunk of await (await rawPending).createReadStream()) csv += chunk.toString();
        check(scenario === "fractional" ? csv.includes('"observation",') && csv.includes("synthetic-fractional-point") : csv.includes('"metadata"') && !csv.includes('"observation",'), "Raw export must retain correct observation/metadata semantics");
        const resultText = await page.locator(".research-results").innerText();
        check(!resultText.includes("Infinity") && !resultText.includes("NaN"), "Zero comparison must not divide by zero");
        await page.locator(".research-results").screenshot({ path: `${out}/${scenario}-${language}.png` });
        checks.push({ scenario, language, missingVersusZero: true, keyboard: true, exportMetadata: true, overflow: false });
        await page.getByRole("button", { name: language === "id" ? "Jumlah deteksi" : "Detection count", exact: true }).click();
      }
    }
    await page.setViewportSize({ width: 720, height: 500 });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "720px reflow");
    check(exceptions.length === 0, exceptions.join("; "));
    return { synthetic: true, checks, reflow720: true, runtimeExceptions: exceptions };
  } catch (error) { await page.screenshot({ path: `${out}/edge-failure.png`, fullPage: true }); throw error; }
  finally { await context.close(); }
}
