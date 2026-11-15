// Requires an explicit local Chrome debugging instance. Tests use a disposable
// incognito context, intercepted synthetic snapshots, and workspace-only downloads.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const base = process.env.TEST_URL || "http://localhost:3002";
const debug = process.env.BROWSER_DEBUG_URL || "http://localhost:9237";
if (
  ![base, debug].every((url) =>
    ["localhost", "127.0.0.1"].includes(new URL(url).hostname),
  )
)
  throw new Error("Acceptance is restricted to local servers");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  const listeners = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const item = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) item.reject(new Error(JSON.stringify(message.error)));
      else item.resolve(message.result);
    }
    for (const listener of listeners.get(message.method) || [])
      listener(message.params);
  });
  return {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    on(method, listener) {
      listeners.set(method, [...(listeners.get(method) || []), listener]);
    },
    close() {
      socket.close();
    },
  };
}
const version = await (await fetch(`${debug}/json/version`)).json();
const browser = await connect(version.webSocketDebuggerUrl);
const { browserContextId } = await browser.send("Target.createBrowserContext");
const output = path.resolve(".cache", `acceptance-${Date.now()}`);
mkdirSync(output, { recursive: true });
const passed = [],
  exceptions = [],
  clients = [];
try {
  await browser.send("Browser.setDownloadBehavior", {
    behavior: "allowAndName",
    browserContextId,
    downloadPath: output,
    eventsEnabled: true,
  });
  const downloads = [];
  browser.on("Browser.downloadProgress", (event) => {
    if (event.state === "completed") downloads.push(event.guid);
  });
  async function page(width, height, mobile = false) {
    const { targetId } = await browser.send("Target.createTarget", {
      url: "about:blank",
      browserContextId,
    });
    const targets = await (await fetch(`${debug}/json/list`)).json();
    const client = await connect(
      targets.find((item) => item.id === targetId).webSocketDebuggerUrl,
    );
    clients.push(client);
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Network.enable");
    await client.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile,
    });
    await client.send("Emulation.setTimezoneOverride", {
      timezoneId: "Asia/Jakarta",
    });
    client.on("Runtime.exceptionThrown", (event) =>
      exceptions.push(
        event.exceptionDetails.exception?.description ||
          event.exceptionDetails.text,
      ),
    );
    const evaluate = async (expression) => {
      const result = await client.send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (result.exceptionDetails)
        throw new Error(result.exceptionDetails.text);
      return result.result.value;
    };
    const until = async (expression) => {
      for (let i = 0; i < 100; i++) {
        if (await evaluate(`Boolean(${expression})`)) return;
        await pause(100);
      }
      throw new Error(`Timed out: ${expression}`);
    };
    const go = async (route) => {
      await client.send("Page.navigate", { url: base + route });
      await until(
        'document.readyState === "complete" && document.querySelector(".mode-select")',
      );
    };
    const select = (selector, value) =>
      evaluate(
        `(()=>{const node=document.querySelector(${JSON.stringify(selector)});node.value=${JSON.stringify(value)};node.dispatchEvent(new Event('change',{bubbles:true}));})()`,
      );
    const click = (text) =>
      evaluate(
        `(()=>{const node=[...document.querySelectorAll('button')].find(n=>n.textContent.trim()===${JSON.stringify(text)});if(!node)throw Error('Missing button');node.focus();node.click();})()`,
      );
    return { ...client, evaluate, until, go, select, click };
  }
  const page1 = await page(1440, 1000);
  let phase = "live",
    held = [],
    slow = false;
  const reportWrites = [];
  let syntheticAuthenticated = false;
  const example = JSON.parse(
    readFileSync("docs/contracts/snapshot-v1.example.json", "utf8"),
  );
  function payload(region) {
    const value = structuredClone(example),
      now = Date.now();
    value.mode = "operational";
    value.status = phase === "partial" ? "partial" : "live";
    value.regionId = region;
    value.runId = `synthetic-${region}-${phase}`;
    value.evaluatedAt = new Date(now - 10000).toISOString();
    value.ingestedAt = new Date(now - 5000).toISOString();
    value.publishedAt = new Date(now - 1000).toISOString();
    value.freshUntil = new Date(now + 3600000).toISOString();
    value.candidates[0].id = `synthetic-${region}`;
    value.candidates[0].name = `SYNTHETIC ${region}`;
    value.candidates[0].observedAt = new Date(now - 3600000).toISOString();
    value.candidates[0].lng = region === "papua" ? 140 : 114;
    value.candidates[0].lat = region === "papua" ? -8 : -2.5;
    if (phase === "partial") value.sources[0].status = "partial";
    if (phase === "replay") {
      value.mode = "replay";
      value.status = "replay";
    }
    if (phase === "invalid") {
      value.mode = "demo";
      value.status = "replay";
      value.candidates[0].name = "DEMO MUST NOT LEAK";
    }
    if (phase === "windows") {
      const ages = [
        24 * 3600000,
        24 * 3600000 + 1,
        7 * 86400000,
        7 * 86400000 + 1,
      ];
      value.candidates = ages.map((age, index) => ({
        ...value.candidates[0],
        id: `window-${index}`,
        name: `Window ${index}`,
        observedAt: new Date(Date.parse(value.evaluatedAt) - age).toISOString(),
      }));
    }
    return value;
  }
  const fulfill = (event, region) =>
    page1.send("Fetch.fulfillRequest", {
      requestId: event.requestId,
      responseCode: phase === "failure" ? 503 : 200,
      responseHeaders: [{ name: "Content-Type", value: "application/json" }],
      body: Buffer.from(
        JSON.stringify(
          phase === "failure" ? { error: "Synthetic outage" } : payload(region),
        ),
      ).toString("base64"),
    });
  await page1.send("Fetch.enable", {
    patterns: [
      { urlPattern: "*/api/snapshots?*" },
      { urlPattern: "*/api/reports" },
      { urlPattern: "*/api/session" },
    ],
  });
  page1.on("Fetch.requestPaused", (event) => {
    const pathname = new URL(event.request.url).pathname;
    if (pathname === "/api/reports" || pathname === "/api/session") {
      let body = pathname === "/api/session" ? { ok: true } : [];
      let responseCode = 200;
      if (pathname === "/api/session")
        syntheticAuthenticated = event.request.method === "POST";
      if (pathname === "/api/reports" && !syntheticAuthenticated) {
        responseCode = 401;
        body = { error: "Synthetic unauthenticated session" };
      }
      if (pathname === "/api/reports" && event.request.method === "POST") {
        const draft = JSON.parse(event.request.postData);
        reportWrites.push(draft);
        responseCode = reportWrites.length === 1 ? 503 : 201;
        body =
          responseCode === 503
            ? { error: "Synthetic write outage" }
            : {
                ...draft,
                id: "synthetic-server-report",
                createdAt: new Date().toISOString(),
              };
      }
      page1
        .send("Fetch.fulfillRequest", {
          requestId: event.requestId,
          responseCode,
          responseHeaders: [
            { name: "Content-Type", value: "application/json" },
          ],
          body: Buffer.from(JSON.stringify(body)).toString("base64"),
        })
        .catch(() => {});
      return;
    }
    const region = new URL(event.request.url).searchParams.get("region");
    if (phase === "offline") {
      page1
        .send("Fetch.failRequest", {
          requestId: event.requestId,
          errorReason: "InternetDisconnected",
        })
        .catch(() => {});
      return;
    }
    if (slow && region === "kalteng") held.push(event);
    else fulfill(event, region).catch(() => {});
  });
  await page1.go("/simulation?region=kalteng&mode=operational");
  await page1.select(".language-switch select", "en");
  await page1.until(
    'document.querySelector(".location-link")?.textContent.includes("SYNTHETIC kalteng")',
  );
  assert(
    (
      await page1.evaluate(
        'document.querySelector(".location-detail dl").textContent',
      )
    ).includes("—"),
  );
  passed.push(
    "Live synthetic snapshot and nullable evidence render without fabricated zeroes",
  );
  phase = "failure";
  await page1.click("Refresh");
  await page1.until(
    'document.querySelector(".snapshot-status strong").textContent === "Stale"',
  );
  assert(
    (
      await page1.evaluate(
        'document.querySelector(".location-link").textContent',
      )
    ).includes("kalteng"),
  );
  phase = "offline";
  await page1.go("/simulation?region=kalteng&mode=operational");
  await page1.until(
    'document.querySelector(".snapshot-status strong").textContent === "Stale"',
  );
  passed.push(
    "Network failure retains region cache across refresh and marks it stale",
  );
  phase = "live";
  await page1.select(".region-select select", "papua");
  await page1.until(
    'document.querySelector(".location-link")?.textContent.includes("SYNTHETIC papua")',
  );
  slow = true;
  await page1.select(".region-select select", "kalteng");
  for (let i = 0; i < 50 && !held.length; i++) await pause(50);
  assert(held.length);
  await page1.select(".region-select select", "papua");
  await page1.until(
    'document.querySelector(".location-link")?.textContent.includes("SYNTHETIC papua")',
  );
  for (const event of held) await fulfill(event, "kalteng").catch(() => {});
  await pause(200);
  assert(
    (
      await page1.evaluate(
        'document.querySelector(".location-link").textContent',
      )
    ).includes("papua"),
  );
  slow = false;
  passed.push(
    "Late response from abandoned region never replaces selected region",
  );
  for (const [testPhase, label] of [
    ["partial", "Partial"],
    ["replay", "Simulation / replay"],
  ]) {
    phase = testPhase;
    await page1.click("Refresh");
    await page1.until(
      `document.querySelector('.snapshot-status strong').textContent === ${JSON.stringify(label)}`,
    );
  }
  phase = "invalid";
  await page1.click("Refresh");
  await pause(300);
  assert(
    !(await page1.evaluate(
      'document.body.textContent.includes("DEMO MUST NOT LEAK")',
    )),
  );
  passed.push(
    "Partial/replay labels and rejection of demo responses in operational mode",
  );
  phase = "live";
  await page1.click("Refresh");
  await page1.until(
    'document.querySelector(".snapshot-status strong").textContent === "Live"',
  );
  phase = "windows";
  await page1.click("Refresh");
  await page1.until(
    'document.querySelector(".location-link")?.textContent.includes("Window")',
  );
  assert.deepEqual(
    await page1.evaluate(
      '[...document.querySelectorAll(".tabs button span")].map(node=>node.textContent)',
    ),
    ["1", "2", "1"],
  );
  await page1.evaluate('document.querySelectorAll(".tabs button")[1].click()');
  assert.equal(
    await page1.evaluate('document.querySelectorAll(".location-link").length'),
    2,
  );
  await page1.evaluate('document.querySelectorAll(".tabs button")[2].click()');
  assert.equal(
    await page1.evaluate('document.querySelectorAll(".location-link").length'),
    1,
  );
  await page1.evaluate('document.querySelectorAll(".tabs button")[0].click()');
  passed.push(
    "Exact 24-hour/seven-day boundary candidates appear once in the matching browser tab",
  );
  phase = "live";
  await page1.click("Refresh");
  await page1.until(
    'document.querySelector(".location-link")?.textContent.includes("SYNTHETIC")',
  );
  for (const format of ["CSV", "JSON"]) {
    const count = downloads.length;
    await page1.click(format);
    for (let i = 0; i < 100 && downloads.length === count; i++) await pause(50);
    assert(downloads.length > count);
    const text = readFileSync(path.join(output, downloads.at(-1)), "utf8");
    assert(text.includes("synthetic-papua-live"));
    assert(text.includes("EXAMPLE-NOT-FIRMS-DATA"));
    if (format === "JSON") assert.equal(JSON.parse(text).regionId, "papua");
    else assert(text.includes('"latitude"'));
  }
  passed.push(
    "CSV and JSON buttons download provenance-bearing region-correct files",
  );
  await page1.select(".mode-select select", "demo");
  await page1.until(
    'document.querySelector(".location-link")?.textContent.includes("Kurik")',
  );
  async function enter() {
    await page1.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      text: "\r",
      unmodifiedText: "\r",
    });
    await page1.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
  }
  await page1.evaluate('document.querySelector(".skip-link").focus()');
  await enter();
  assert.equal(
    await page1.evaluate("document.activeElement.id"),
    "workspace-content",
  );
  await page1.evaluate('document.querySelectorAll(".nav-item")[1].focus()');
  await enter();
  await page1.until('!document.querySelector(".analysis-grid")');
  const selectedName = await page1.evaluate(
    'document.querySelectorAll(".location-link")[1].firstChild.textContent',
  );
  await page1.evaluate(
    'document.querySelectorAll(".location-link")[1].focus()',
  );
  await enter();
  await page1.until(
    `document.querySelector('.location-detail h3').textContent === ${JSON.stringify(selectedName)}`,
  );
  passed.push(
    "Keyboard skip link, navigation and candidate selection activate correctly",
  );
  await page1.click("Record inspection");
  await page1.until('document.querySelector("dialog").open');
  for (let i = 0; i < 9; i++) {
    await page1.send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Tab",
      code: "Tab",
      windowsVirtualKeyCode: 9,
    });
    await page1.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Tab",
      code: "Tab",
      windowsVirtualKeyCode: 9,
    });
    assert(
      await page1.evaluate(
        'document.querySelector("dialog").contains(document.activeElement)',
      ),
    );
  }
  await page1.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await page1.until('!document.querySelector("dialog").open');
  assert.equal(
    await page1.evaluate("document.activeElement.textContent.trim()"),
    "Record inspection",
  );
  passed.push("Native dialog traps Tab, closes with Escape, and returns focus");
  async function fillAndSubmit(notes) {
    await page1.evaluate(
      `(()=>{const form=document.querySelector('dialog form');const d=new Date(Date.now()-3600000);form.elements.time.value=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);form.elements.result.value='Belum dapat dipastikan';form.elements.notes.value=${JSON.stringify(notes)};form.requestSubmit();})()`,
    );
  }
  await page1.click("Record inspection");
  await page1.until('document.querySelector("dialog").open');
  await fillAndSubmit("Acceptance persistent report");
  await page1.until('!document.querySelector("dialog").open');
  await page1.go("/simulation?region=papua");
  await page1.until('document.documentElement.lang === "en"');
  await page1.evaluate(
    '[...document.querySelectorAll("nav button")].find(n=>n.textContent.includes("Field reports")).click()',
  );
  await page1.until(
    'document.querySelector(".report-row")?.textContent.includes("Acceptance persistent report")',
  );
  await page1.select(".region-select select", "kalteng");
  await pause(100);
  assert.equal(
    await page1.evaluate('document.querySelectorAll(".report-row").length'),
    0,
  );
  await page1.select(".region-select select", "papua");
  await page1.until('document.querySelector(".report-row")');
  passed.push(
    "Demo report survives reload, language persists, and report regions stay separate",
  );
  await page1.click("Record inspection");
  await page1.until('document.querySelector("dialog").open');
  await page1.evaluate(
    'window.savedSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==="pyro-reports")throw Error("Synthetic storage outage");return window.savedSetItem.call(this,key,value)}',
  );
  await fillAndSubmit("Must not be saved");
  await page1.until('document.querySelector("dialog [role=alert]")');
  assert(await page1.evaluate('document.querySelector("dialog").open'));
  assert.equal(
    await page1.evaluate(
      'JSON.parse(localStorage.getItem("pyro-reports")).length',
    ),
    1,
  );
  await page1.evaluate("Storage.prototype.setItem=window.savedSetItem");
  passed.push(
    "Storage failure keeps form open and never claims successful save",
  );
  await page1.select(".mode-select select", "operational");
  await page1.until('document.querySelector(".connection-form")');
  await page1.evaluate(
    'document.querySelector(".connection-form input").value="synthetic-access-only-in-browser-context";document.querySelector(".connection-form").requestSubmit()',
  );
  await page1.until(
    '[...document.querySelectorAll("button")].some(node=>node.textContent.trim()==="Sign out")',
  );
  await page1.until(
    'document.querySelector(".reports .primary") && !document.querySelector(".reports .primary").disabled',
  );
  await page1.click("Record inspection");
  await page1.until('document.querySelector("dialog").open');
  await fillAndSubmit("Synthetic API retry");
  await page1.until('document.querySelector("dialog [role=alert]")');
  assert(await page1.evaluate('document.querySelector("dialog").open'));
  await page1.click("Save report");
  await page1.until('!document.querySelector("dialog").open');
  assert.equal(reportWrites.length, 2);
  assert.equal(reportWrites[0].requestId, reportWrites[1].requestId);
  assert.equal(
    await page1.evaluate('document.querySelectorAll(".report-row").length'),
    1,
  );
  passed.push(
    "Synthetic API save failure keeps draft; retry reuses request ID and shows one saved report",
  );
  const mobile = await page(390, 844, true);
  await mobile.go("/simulation?region=kalteng");
  assert(
    !(await mobile.evaluate(
      "document.documentElement.scrollWidth > innerWidth",
    )),
  );
  assert(
    (await mobile.evaluate(
      'document.querySelector(".region-select").getBoundingClientRect().width',
    )) > 280,
  );
  passed.push("Mobile layout and selected-region control remain usable");
  assert.deepEqual(exceptions, []);
  writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify({ passed, exceptions, syntheticNetwork: true }, null, 2),
  );
  console.log(JSON.stringify({ passed, output, exceptions }, null, 2));
} finally {
  for (const client of clients) client.close();
  await browser.send("Target.disposeBrowserContext", { browserContextId });
  browser.close();
}
