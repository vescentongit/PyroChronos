// Tests the bundled real FIRMS snapshot with all external requests blocked.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, createWriteStream, writeFileSync, readFileSync } from "node:fs";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const snapshot = JSON.parse(readFileSync("src/data/globe-hotspots.json", "utf8"));
const output = process.env.GLOBE_QA_OUTPUT || ".cache/globe-snapshot-browser";
const port = process.env.GLOBE_QA_PORT || "3150", base = `http://127.0.0.1:${port}`;
mkdirSync(output, { recursive: true });
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", port], {
  windowsHide: true, env: { ...process.env, FIRMS_MAP_KEY: "" }, stdio: ["ignore", "pipe", "pipe"],
});
const log = createWriteStream(`${output}/server.log`);
server.stdout.pipe(log); server.stderr.pipe(log);
let browser, page;
const errors = [], checks = [], requests = [], startedAt = new Date().toISOString();
function report(extra) {
  const result = { passed: false, startedAt, finishedAt: new Date().toISOString(), bundledRealSnapshot: true,
    snapshotPeriod: [snapshot.periodStart, snapshot.periodEnd], checks, runtimeErrors: errors, ...extra };
  writeFileSync(`${output}/result.json`, JSON.stringify(result, null, 2)); return result;
}
report({ status: "running" });
try {
  let ready = false;
  for (let i = 0; i < 100; i++) { try { ready = (await fetch(base)).ok; } catch {} if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100)); }
  assert(ready, "production server starts");
  browser = await chromium.launch({ headless: true });
  async function context(options = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...options });
    await ctx.route("https://**/*", route => route.abort());
    await ctx.route("**/api/hotspots**", route => {
      requests.push(route.request().url());
      return route.fulfill({ status: 503, json: { code: "DEPENDENCY_UNAVAILABLE", reason: "NETWORK_ERROR" } });
    });
    ctx.on("page", p => p.on("pageerror", error => errors.push(error.message)));
    return ctx;
  }
  const canvas = () => page.locator(".earth-visualization canvas");
  async function home() {
    await page.goto(base);
    await page.locator('.landing-readout[data-feed-state="snapshot"]').waitFor();
    await page.locator(".earth-load").waitFor({ state: "hidden" });
  }
  async function redPixels() {
    return canvas().evaluate(node => {
      const pixels = node.getContext("2d").getImageData(0, 0, node.width, node.height).data;
      let red = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i] > 220 && pixels[i + 1] < 130 && pixels[i + 2] < 100 && pixels[i + 3] > 100) red++;
      return red;
    });
  }
  const desktop = await context(); page = await desktop.newPage(); await home();
  await page.getByRole("button", { name: "Pause rotation", exact: true }).click();
  assert.match(await page.locator(".landing-readout").innerText(), /372,148 detections · 7 days/);
  assert.match(await page.locator(".landing-readout").innerText(), /8–14 November 2026 UTC · fixed snapshot/);
  assert.equal(requests.length, 0, "Home never requests the live FIRMS API");
  assert((await redPixels()) > 2000, "actual bundled hotspots are visible by default without NASA connectivity");
  await page.getByRole("button", { name: "FIRMS hotspots", exact: true }).click(); assert.equal(await redPixels(), 0);
  await page.getByRole("button", { name: "FIRMS hotspots", exact: true }).click(); assert((await redPixels()) > 2000);
  await canvas().screenshot({ path: `${output}/globe.png` });
  await page.screenshot({ path: `${output}/desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 768, height: 1024 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: `${output}/tablet.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForFunction(() => {
    const node = document.querySelector(".earth-visualization canvas");
    return parseFloat(node.style.width) === Math.min(820, node.parentElement.clientWidth);
  });
  checks.push("Real seven-day snapshot renders immediately with source/dates and visible points; no live API dependency");
  let box = await canvas().boundingBox();
  await canvas().click({ position: { x: 20, y: 20 } });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 90, box.y + box.height / 2 + 20, { steps: 8 }); await page.mouse.up();
  assert.equal(await page.locator(".earth-opening").count(), 0); assert.equal(new URL(page.url()).pathname, "/");
  await page.getByRole("button", { name: "Reset to Indonesia", exact: true }).click();
  box = await canvas().boundingBox();
  const arrivalRequest = page.waitForRequest(request => request.url().includes("/api/hotspots?")).catch(() => null);
  await canvas().click({ position: { x: box.width / 2, y: box.height / 2 } });
  await page.locator(".earth-opening-label").waitFor(); assert.equal(new URL(page.url()).pathname, "/");
  await page.waitForTimeout(200); await page.screenshot({ path: `${output}/zoom.png` });
  await page.waitForURL("**/simulation?**", { timeout: 5000 });
  const target = new URL(page.url()).searchParams, lng = Number(target.get("lng")), lat = Number(target.get("lat"));
  assert(Math.abs(lng - 119) < 5 && Math.abs(lat + 4) < 5);
  const arrival = await arrivalRequest; assert(arrival);
  const [west, south, east, north] = new URL(arrival.url()).searchParams.get("bbox").split(",").map(Number);
  assert(west <= lng && east >= lng && south <= lat && north >= lat);
  checks.push("Drag/outside click stay on Home; click zooms then opens the selected location on the current map");

  const mobile = await context({ viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  page = await mobile.newPage(); await home();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByRole("button", { name: "Play rotation", exact: true }).waitFor();
  assert((await redPixels()) > 250, "snapshot points remain visible on a small screen");
  await page.screenshot({ path: `${output}/mobile.png`, fullPage: true });
  box = await canvas().boundingBox();
  await canvas().tap({ position: { x: box.width * .7, y: box.height / 2 } }); await page.waitForURL("**/simulation?**");
  await home(); await canvas().focus(); await page.keyboard.press("ArrowRight"); await page.keyboard.press("Enter");
  await page.waitForURL("**/simulation?**"); assert.equal(Number(new URL(page.url()).searchParams.get("lng")), 111);
  checks.push("Desktop/tablet/320px mobile fit; touch and reduced-motion keyboard navigation work");

  const fixed = await context({ reducedMotion: "reduce" }); page = await fixed.newPage(); await page.clock.install(); await home();
  const before = requests.length; await page.clock.fastForward(3 * 86400000);
  assert.equal(requests.length, before); assert.match(await page.locator(".landing-readout").innerText(), /372,148 detections · 7 days/);
  assert.match(await page.locator(".landing-readout").innerText(), /8–14 November 2026 UTC/);
  await page.getByRole("button", { name: "ID", exact: true }).click();
  assert.match(await page.locator(".landing-readout").innerText(), /372\.148 deteksi · 7 hari/);
  assert.match(await page.locator(".landing-readout").innerText(), /snapshot tetap/);
  checks.push("Snapshot stays unchanged after three simulated days; Indonesian copy shows the same fixed period");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(report({ passed: true, status: "passed" }), null, 2));
} catch (error) {
  if (page) await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {});
  report({ status: "failed", error: error.message }); throw error;
} finally { await browser?.close(); if (server.exitCode === null) { const exit = once(server, "exit"); server.kill(); await exit; } }
