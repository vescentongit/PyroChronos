import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import assert from "node:assert/strict";
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const out = ".cache/research-sprint-1";
mkdirSync(out, { recursive: true });
async function session(width, height, mobile = false) {
  const target = await (
    await fetch("http://localhost:9237/json/new?about:blank", { method: "PUT" })
  ).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let seq = 0;
  const pending = new Map(),
    errors = [];
  ws.addEventListener("message", (event) => {
    const m = JSON.parse(event.data);
    if (m.id) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.reject(new Error(JSON.stringify(m.error)));
      else p.resolve(m.result);
    }
    if (m.method === "Runtime.exceptionThrown")
      errors.push(
        m.params.exceptionDetails.exception?.description ||
          m.params.exceptionDetails.text,
      );
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
  });
  await send("Emulation.setTimezoneOverride", { timezoneId: "Asia/Jakarta" });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  const until = async (expression) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate("Boolean(" + expression + ")")) return;
      await pause(150);
    }
    throw new Error("Timeout: " + expression);
  };
  const go = async (path) => {
    await send("Page.navigate", { url: "http://localhost:3002" + path });
    await until('document.readyState === "complete"');
  };
  const shot = async (name) => {
    await evaluate("document.fonts.ready.then(()=>true)");
    const metrics = await send("Page.getLayoutMetrics");
    const data = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: {
        x: 0,
        y: 0,
        width,
        height: Math.ceil(metrics.cssContentSize.height),
        scale: 1,
      },
    });
    writeFileSync(out + "/" + name + ".png", Buffer.from(data.data, "base64"));
  };
  return { send, evaluate, until, go, shot, errors, close: () => ws.close() };
}
const fixtures = JSON.parse(
  readFileSync("docs/contracts/api-v2.examples.json", "utf8"),
).examples;
const mockSource = `(() => {
 localStorage.setItem('pyro-language','id');
 const fixtures = ${JSON.stringify(fixtures)};
 const original = window.fetch;
 window.researchCalls = [];
 window.nrtCalls = [];
 window.analysisFailure = false;
 window.jobState = 'queued';
 window.lastAnalysis = null;
 window.fetch = async (input, options = {}) => {
  const url = String(input);
  if (url.startsWith('/api/hotspots?')) {
    window.nrtCalls.push(url);
    const params = new URL(url, location.origin).searchParams;
    const bbox = params.get('bbox').split(',').map(Number);
    const clock = Date.now();
    const now = new Date(clock).toISOString();
    const hours = Number(params.get('hours'));
    return Response.json({schemaVersion:'hotspots-1', source:params.get('source'), hours, bbox, status:'available',
      fetchedAt:now,evaluatedAt:now,freshUntil:new Date(clock+600000).toISOString(),observedTo:now,
      observedFrom:new Date(clock-hours*3600000).toISOString(),checksum:'synthetic-browser-only',total:1,gridDegrees:0,unit:'detections',sample:[],
      features:[{type:'Feature',geometry:{type:'Point',coordinates:[113,-3]},properties:{count:1,observedAt:now}}]});
  }
  if (!url.startsWith('/api/v2/')) return original(input, options);
  const body = options.body ? JSON.parse(options.body) : null;
  window.researchCalls.push({ url, body });
  if (url === '/api/v2/workspaces') return Response.json({items:[fixtures.workspace],nextCursor:null});
  if (url.endsWith('/areas')) return Response.json({...fixtures.area, name:body.name, geometry:body.geometry});
  if (url.endsWith('/analyses') && body) {
    window.lastAnalysis = body;
    if (window.analysisFailure) return Response.json({...fixtures.error, code:'DEPENDENCY_UNAVAILABLE'}, {status:503});
    return Response.json({...fixtures.job, requestId:body.requestId, status:'queued', startedAt:null, completedAt:null, resultId:null, progressPercent:0});
  }
  if (url.includes('/jobs/')) {
    const state = window.jobState;
    return Response.json({...fixtures.job,requestId:window.lastAnalysis.requestId,status:state,
      startedAt:state==='queued'?null:fixtures.job.startedAt, completedAt:state==='succeeded'?fixtures.job.completedAt:null,
      resultId:state==='succeeded'?fixtures.job.resultId:null, progressPercent:state==='succeeded'?100:state==='running'?50:0});
  }
  if (url.includes('/days?')) return Response.json(fixtures['daily-page']);
  if (url.includes('/detections?')) return Response.json({...fixtures['detections-page'],nextCursor:null});
  if (url.includes('/analyses/')) return Response.json({...fixtures.result,comparison:null});
  return Response.json(fixtures.error, {status:404});
 };
})();`;
const desktop = await session(1440, 1000);
await desktop.send("Page.addScriptToEvaluateOnNewDocument", {
  source: mockSource,
});
await desktop.go("/simulation");
await desktop.until('document.querySelector(".global-heatmap")');
const click = async (tab, text) =>
  tab.evaluate(
    `Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(text)})?.click()`,
  );
const change = async (tab, selector, value) =>
  tab.evaluate(
    `(() => { const element=document.querySelector(${JSON.stringify(selector)}); const prototype=element.tagName==='SELECT'?HTMLSelectElement.prototype:element.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype,'value').set.call(element,${JSON.stringify(value)}); element.dispatchEvent(new Event(element.tagName==='SELECT'?'change':'input',{bubbles:true})); })()`,
  );
assert.equal(
  await desktop.evaluate(
    `performance.getEntriesByType('resource').filter(r=>r.name.includes('/api/hotspots?')).length`,
  ),
  0,
);
await desktop.evaluate(
  `window.originalMapCanvas=document.querySelector('.maplibregl-canvas')`,
);
await click(desktop, "Kalimantan");
await click(desktop, "Titik / agregat mentah");
await pause(200);
assert.equal(
  await desktop.evaluate(
    `performance.getEntriesByType('resource').filter(r=>r.name.includes('/api/hotspots?')).length`,
  ),
  0,
);
await click(desktop, "Muat area tampilan");
await desktop.until(
  `document.querySelector('.global-data-status').textContent.includes('Data FIRMS tersedia')`,
);
assert.equal(await desktop.evaluate("window.nrtCalls.length"), 1);
await click(desktop, "Muat area tampilan");
await pause(600);
assert.equal(await desktop.evaluate("window.nrtCalls.length"), 1);
await click(desktop, "Papua");
await desktop.evaluate(
  `document.querySelector('.maplibregl-ctrl-zoom-in').click()`,
);
await pause(600);
assert.equal(await desktop.evaluate("window.nrtCalls.length"), 1);
assert.equal(
  await desktop.evaluate(
    `document.querySelector('.global-data-status').textContent.includes('Data FIRMS tersedia')`,
  ),
  true,
);
await click(desktop, "Kalimantan");
await click(desktop, "Riset historis");
await desktop.until('document.querySelector(".research-panel select").value');
await desktop.evaluate(
  `document.querySelector('.research-panel details').open=true`,
);
await change(
  desktop,
  ".research-coordinate-editor textarea",
  "113, -4\n115, -3\n114, 0\n112, -1",
);
await click(desktop, "Gunakan koordinat sebagai draft");
await click(desktop, "Terapkan polygon");
await desktop.until(
  `document.querySelector('.research-panel .global-toolbar').textContent.includes('1')`,
);
assert.equal(
  await desktop.evaluate("window.researchCalls.filter(c=>c.body).length"),
  0,
);
await click(desktop, "Gambar / edit polygon");
await desktop.until(`document.querySelector('.global-drawing-tools button')`);
const canvasBox = await desktop.evaluate(
  `(() => {const r=document.querySelector('.maplibregl-canvas').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
);
await desktop.send("Input.dispatchMouseEvent", {
  type: "mousePressed",
  button: "left",
  clickCount: 1,
  ...canvasBox,
});
await desktop.send("Input.dispatchMouseEvent", {
  type: "mouseReleased",
  button: "left",
  clickCount: 1,
  ...canvasBox,
});
await desktop.until(
  `document.querySelector('.global-drawing-tools').textContent.includes('5 titik')`,
);
await desktop.evaluate(
  `document.querySelectorAll('.global-drawing-tools button')[1].click()`,
);
await desktop.until(
  `document.querySelector('.research-panel .global-toolbar').textContent.includes('4 titik')`,
);
await change(desktop, ".research-fields input[maxlength]", "Synthetic polygon");
await desktop.evaluate(
  `document.querySelectorAll('.research-panel details')[1].open=true`,
);
await change(
  desktop,
  '.research-panel details .research-fields input:not([type="number"])',
  "synthetic-quality-1",
);
await desktop.until(
  `!document.querySelector('.research-panel button.primary').disabled`,
);
await desktop.evaluate("window.analysisFailure=true");
await click(desktop, "Analisis area");
await desktop.until(
  `document.querySelector('.research-panel').textContent.includes('Analisis gagal')`,
);
const failedRequest = await desktop.evaluate("window.lastAnalysis.requestId");
await desktop.evaluate("window.analysisFailure=false");
await click(desktop, "Analisis area");
await desktop.until(
  `document.querySelector('.research-panel').textContent.includes('Analisis dalam antrean')`,
);
assert.equal(
  await desktop.evaluate("window.lastAnalysis.requestId"),
  failedRequest,
);
await desktop.evaluate('window.jobState="running"');
await desktop.until(
  `document.querySelector('.research-panel').textContent.includes('Analisis sedang diproses')`,
);
await desktop.evaluate('window.jobState="succeeded"');
await desktop.until('document.querySelector(".research-results")');
await click(desktop, "Muat titik mentah hasil");
await desktop.until(
  `document.querySelector('.research-results').textContent.includes('1 titik dimuat')`,
);
await click(desktop, "2026-08");
await desktop.until(`document.querySelector('.research-results details')`);
assert.equal(
  await desktop.evaluate(
    `document.querySelector('.maplibregl-canvas')===window.originalMapCanvas`,
  ),
  true,
);
await click(desktop, "Dashboard");
await click(desktop, "Peta aktivitas");
assert.equal(
  await desktop.evaluate(
    `document.querySelector('.maplibregl-canvas')===window.originalMapCanvas`,
  ),
  true,
);
const resultBefore = await desktop.evaluate(
  'document.querySelector(".research-results").textContent',
);
await change(desktop, '.research-fields input[type="date"]', "2026-07-01");
assert.equal(
  await desktop.evaluate(
    'document.querySelector(".research-results").textContent',
  ),
  resultBefore,
);
await desktop.evaluate('window.jobState="queued"');
await click(desktop, "Analisis area");
await desktop.until(
  `document.querySelector('.research-panel').textContent.includes('Analisis dalam antrean')`,
);
await change(desktop, '.research-fields input[type="date"]', "2026-06-01");
await desktop.evaluate('window.jobState="succeeded"');
await pause(2200);
assert.equal(
  await desktop.evaluate(
    'document.querySelector(".research-results").textContent',
  ),
  resultBefore,
);
await click(desktop, "Lihat contoh sintetis");
await desktop.evaluate(
  `document.querySelectorAll('.research-panel details').forEach(d=>d.open=false)`,
);
await desktop.shot("desktop-id");
await change(desktop, ".language-switch select", "en");
await desktop.until(`document.documentElement.lang==='en'`);
await desktop.shot("desktop-en");
assert.equal(
  await desktop.evaluate("document.documentElement.scrollWidth <= innerWidth"),
  true,
);
assert.equal(
  await desktop.evaluate(
    `document.querySelector('.research-results').textContent.includes('Synthetic example / replay')`,
  ),
  true,
);
assert.equal(
  await desktop.evaluate(
    `getComputedStyle(document.body).fontFamily.includes('Jakarta')`,
  ),
  true,
);
const mobile = await session(390, 844, true);
await mobile.go("/simulation");
await mobile.until('document.querySelector(".global-heatmap")');
await click(mobile, "Historical research");
await mobile.until(
  `document.querySelector('.research-panel').textContent.includes('Research v2 service is unavailable')`,
);
await click(mobile, "Preview synthetic example");
await mobile.until('document.querySelector(".research-results")');
await mobile.shot("mobile-en");
assert.equal(
  await mobile.evaluate("document.documentElement.scrollWidth <= innerWidth"),
  true,
);
await mobile.evaluate(
  `document.querySelector('.research-panel button').focus()`,
);
await mobile.send("Input.dispatchKeyEvent", {
  type: "keyDown",
  key: "Tab",
  code: "Tab",
  windowsVirtualKeyCode: 9,
});
await mobile.send("Input.dispatchKeyEvent", {
  type: "keyUp",
  key: "Tab",
  code: "Tab",
  windowsVirtualKeyCode: 9,
});
assert.equal(
  await mobile.evaluate(`document.activeElement.tagName==='BUTTON'`),
  true,
);
assert.deepEqual(desktop.errors, []);
assert.deepEqual(mobile.errors, []);
writeFileSync(
  out + "/results.json",
  JSON.stringify(
    {
      passed: true,
      checks: [
        "no auto FIRMS on camera changes",
        "stable map across layers and Dashboard",
        "non-rectangular AOI via keyboard",
        "no writes before Analyze",
        "idempotent retry",
        "queued/running/success",
        "stale response protection",
        "daily/point consumer",
        "synthetic labels",
        "EN/ID",
        "390px overflow",
        "keyboard focus",
        "Plus Jakarta Sans",
      ],
      limitations: [
        "v2 responses mocked on desktop; real missing-backend state on mobile",
        "external imagery may be unavailable in sandbox",
      ],
    },
    null,
    2,
  ),
);
console.log(
  "Research browser acceptance passed. Screenshots and results: " + out,
);
desktop.close();
mobile.close();
