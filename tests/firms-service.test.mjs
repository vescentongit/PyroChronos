import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import https from "node:https";
import { registerHooks, syncBuiltinESMExports } from "node:module";
import { Readable } from "node:stream";
import { afterEach, mock, test } from "node:test";

// Match Next's extensionless TS imports when testing with Node directly.
const hook = registerHooks({
  resolve(specifier, context, next) {
    return next(
      context.parentURL?.endsWith("/firms-service.ts") &&
        specifier.startsWith("./")
        ? `${specifier}.ts`
        : specifier,
      context,
    );
  },
});
const { getFirmsBatch } = await import("../src/lib/firms-service.ts");
hook.deregister();
const { downloadFirmsCsv } = await import("../src/lib/firms-download.ts");
const originalKey = process.env.FIRMS_MAP_KEY;
const secret = "test-private-key-never-expose";
const csv =
  "latitude,longitude,acq_date,acq_time,satellite,confidence,frp\n-2.5,114,2026-11-10,0015,N,n,12\n";
const query = {
  source: "VIIRS_NOAA20_NRT",
  hours: 24,
  zoom: 2,
  bbox: [94, -12, 142, 7],
};
afterEach(() => {
  mock.restoreAll();
  mock.timers.reset();
  syncBuiltinESMExports();
  if (originalKey === undefined) delete process.env.FIRMS_MAP_KEY;
  else process.env.FIRMS_MAP_KEY = originalKey;
});

function transport(reply) {
  process.env.FIRMS_MAP_KEY = secret;
  const calls = [];
  mock.method(https, "get", (url) => {
    calls.push(url);
    const request = new EventEmitter();
    let response;
    request.destroy = () => {
      response?.destroy();
      request.emit("close");
    };
    queueMicrotask(() => {
      const result = reply(url);
      if (result.error) {
        request.emit("error", result.error);
        request.emit("close");
        return;
      }
      if (result.stall) return;
      response = Readable.from(
        result.chunks ?? [Buffer.from(result.csv ?? csv)],
      );
      response.statusCode = result.status ?? 200;
      response.complete = result.complete ?? true;
      response.once("close", () => request.emit("close"));
      request.emit("response", response);
    });
    return request;
  });
  syncBuiltinESMExports();
  return calls;
}

test("download is scoped to the viewport, shares in-flight work and isolates cached areas", async () => {
  const calls = transport(() => ({}));
  const [a, b] = await Promise.all([
    getFirmsBatch(query),
    getFirmsBatch(query),
  ]);
  assert.equal(calls.length, 1);
  assert.equal(a.checksum, b.checksum);
  assert.equal(a.rows.length, 1);
  assert(calls[0].pathname.endsWith("/94,-12,142,7/2"));
  await getFirmsBatch({ ...query, zoom: 8 });
  assert.equal(calls.length, 1);
  await getFirmsBatch({ ...query, bbox: [110, -5, 120, 5] });
  assert.equal(calls.length, 2);
});

test("date-line viewports split into valid boxes and deduplicate detections", async () => {
  const calls = transport(() => ({}));
  const result = await getFirmsBatch({ ...query, bbox: [170, -20, -170, 20] });
  assert.deepEqual(
    calls.map((url) => url.pathname.split("/").at(-2)),
    ["170,-20,180,20", "-180,-20,-170,20"],
  );
  assert.equal(result.rows.length, 1);
});

test("world coverage and the 96-hour calendar window remain supported", async () => {
  const calls = transport(() => ({}));
  await getFirmsBatch({ ...query, hours: 96, bbox: [-180, -90, 180, 90] });
  assert(calls[0].pathname.endsWith("/-180,-90,180,90/5"));
});

test("FIRMS text errors and invalid CSV retain safe, specific reasons", async () => {
  let body = "Invalid MAP_KEY.";
  transport(() => ({ csv: body }));
  const q = { ...query, source: "MODIS_NRT", bbox: [10, 0, 20, 10] };
  await assert.rejects(
    getFirmsBatch(q),
    (e) => e.reason === "UPSTREAM_DENIED" && !e.message.includes(secret),
  );
  body = "<html>Service unavailable</html>";
  await assert.rejects(
    getFirmsBatch(q),
    (e) => e.reason === "INVALID_RESPONSE",
  );
  body = csv;
  assert.equal((await getFirmsBatch(q)).rows.length, 1);
});

test("missing configuration fails before issuing a request", async () => {
  const calls = transport(() => ({}));
  delete process.env.FIRMS_MAP_KEY;
  await assert.rejects(
    getFirmsBatch(query),
    (e) => e.reason === "NOT_CONFIGURED",
  );
  assert.equal(calls.length, 0);
});

test("transport classifies failures without leaking request URLs or exception messages", async () => {
  let reply = { status: 403 };
  transport(() => reply);
  const url = new URL(`https://example.invalid/${secret}`);
  for (const [result, reason] of [
    [{ status: 403 }, "UPSTREAM_DENIED"],
    [{ status: 429 }, "RATE_LIMITED"],
    [{ status: 503 }, "UPSTREAM_UNAVAILABLE"],
    [{ error: new Error(`connect EACCES ${url}`) }, "NETWORK_ERROR"],
    [{ complete: false }, "NETWORK_ERROR"],
    [{ chunks: [Buffer.alloc(12 * 1024 * 1024 + 1)] }, "PAYLOAD_TOO_LARGE"],
  ]) {
    reply = result;
    await assert.rejects(
      downloadFirmsCsv(url),
      (e) => e.reason === reason && !e.message.includes(secret),
    );
  }
});

test("a stalled download has a bounded total timeout", async () => {
  transport(() => ({ stall: true }));
  mock.timers.enable({ apis: ["setTimeout"] });
  const check = assert.rejects(
    downloadFirmsCsv(new URL("https://example.invalid/")),
    (e) => e.reason === "TIMEOUT",
  );
  await Promise.resolve();
  mock.timers.tick(25000);
  await check;
});
