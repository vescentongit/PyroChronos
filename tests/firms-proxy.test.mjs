import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { test } from 'node:test';

import * as proxy from '../src/lib/firms-proxy.ts';
const SECRET = 'sentinel-FIRMS-private-key-never-expose';
const CSV = Buffer.from('latitude,longitude,acq_date,acq_time,satellite,confidence,version,frp\n-2.5,114,2026-11-09,0045,N,n,2,7\n');
function request(query = '') { return new Request(`https://pyro.invalid/api/firms${query}`); }
function mockGet(chunks, { statusCode = 200, headers = {}, complete = true, delay = 0 } = {}) {
  const calls = [];
  const get = (url, options, callback) => {
    calls.push({ url, options });
    const outgoing = new EventEmitter();
    outgoing.destroy = () => {};
    queueMicrotask(() => {
      const incoming = Readable.from((async function* () {
        for (const chunk of chunks) {
          if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
          yield chunk;
        }
      })());
      Object.assign(incoming, { statusCode, headers, complete });
      callback(incoming);
    });
    return outgoing;
  };
  return { get, calls };
}
test('public GET rejects inherited keys, arbitrary coordinates and invalid sources before network', async () => {
  assert.ok(proxy);
  let calls = 0;
  const handle = proxy.createFirmsProxy(async () => { calls++; throw new Error(SECRET); });
  for (const query of ['?region=__proto__', '?region=constructor', '?source=toString',
    '?bbox=0,0,1,1', '?region=kalteng&region=papua', '?region=']) {
    const response = await handle(request(query));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).retryable, false);
  }
  assert.equal(calls, 0);
});
test('GET returns CSV with safe source metadata and never persists a raw batch', async () => {
  assert.ok(proxy);
  const saved = process.env.FIRMS_MAP_KEY;
  process.env.FIRMS_MAP_KEY = SECRET;
  try {
    const handle = proxy.createFirmsProxy(async (key, source, bbox) => {
      assert.equal(key, SECRET);
      assert.equal(source, 'MODIS_NRT');
      assert.deepEqual(bbox, [139.5, -8.8, 141, -7.5]);
      return { ok: true, body: CSV };
    });
    const response = await handle(request('?region=papua&source=MODIS_NRT'));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), CSV.toString());
    assert.equal(response.headers.get('cache-control'), 'no-store');
  } finally { if (saved === undefined) delete process.env.FIRMS_MAP_KEY; else process.env.FIRMS_MAP_KEY = saved; }
});
test('missing key and thrown upstream sentinel produce safe structured responses', async () => {
  assert.ok(proxy);
  const saved = process.env.FIRMS_MAP_KEY;
  try {
    delete process.env.FIRMS_MAP_KEY;
    const handle = proxy.createFirmsProxy(async () => { throw new Error(`https://evil.invalid/${SECRET}`); });
    assert.equal((await (await handle(request())).json()).errorCode, 'CONFIG_MISSING');
    process.env.FIRMS_MAP_KEY = SECRET;
    const response = await handle(request());
    const body = await response.text();
    assert.equal(response.status, 502);
    assert.equal(JSON.parse(body).errorCode, 'UPSTREAM_UNAVAILABLE');
    assert.ok(!body.includes(SECRET));
  } finally { if (saved === undefined) delete process.env.FIRMS_MAP_KEY; else process.env.FIRMS_MAP_KEY = saved; }
});
test('HTTPS transport streams a bounded valid CSV to the official NASA host', async () => {
  assert.ok(proxy);
  const { get, calls } = mockGet([CSV]);
  const result = await proxy.downloadFirms(SECRET, 'MODIS_NRT', [113, -3.6, 115, -1.5], { get });
  assert.equal(result.ok, true);
  assert.equal(calls[0].url.protocol, 'https:');
  assert.equal(calls[0].url.hostname, 'firms.modaps.eosdis.nasa.gov');
});
test('redirect, rate limit, HTML, malformed CSV, truncation and secret echoes are rejected', async () => {
  assert.ok(proxy);
  for (const [chunks, options, code] of [
    [[CSV], { statusCode: 302, headers: { location: `https://evil.invalid/${SECRET}` } }, 'UPSTREAM_REDIRECT'],
    [[CSV], { statusCode: 429 }, 'UPSTREAM_RATE_LIMITED'],
    [[Buffer.from('<html>error</html>')], {}, 'INVALID_RESPONSE'],
    [[Buffer.from('latitude,longitude\n"unterminated')], {}, 'INVALID_RESPONSE'],
    [[CSV], { complete: false }, 'INVALID_RESPONSE'],
    [[CSV], { headers: { 'content-length': '999' } }, 'INVALID_RESPONSE'],
    [[Buffer.concat([CSV, Buffer.from(SECRET)])], {}, 'INVALID_RESPONSE'],
  ]) {
    const { get, calls } = mockGet(chunks, options);
    const result = await proxy.downloadFirms(SECRET, 'MODIS_NRT', [113, -3.6, 115, -1.5], { get });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, code);
    assert.ok(!JSON.stringify(result).includes(SECRET));
    assert.equal(calls.length, 1);
  }
});
test('global deadline covers slow body and streaming size cap stops oversized responses', async () => {
  assert.ok(proxy);
  const slow = mockGet([CSV, CSV], { delay: 30 });
  const timed = await proxy.downloadFirms(SECRET, 'MODIS_NRT', [113, -3.6, 115, -1.5],
    { get: slow.get, timeoutMs: 10 });
  assert.equal(timed.errorCode, 'UPSTREAM_TIMEOUT');
  const large = mockGet([CSV]);
  const bounded = await proxy.downloadFirms(SECRET, 'MODIS_NRT', [113, -3.6, 115, -1.5],
    { get: large.get, maxBytes: 10 });
  assert.equal(bounded.errorCode, 'PAYLOAD_TOO_LARGE');
});
test('adapter errors cannot inject an unsafe code or secret into the public response', async () => {
  const saved = process.env.FIRMS_MAP_KEY;
  process.env.FIRMS_MAP_KEY = SECRET;
  try {
    const handle = proxy.createFirmsProxy(async () => ({ ok: false,
      errorCode: SECRET, retryable: true, httpStatus: 502 }));
    const body = await (await handle(request())).text();
    assert.ok(!body.includes(SECRET));
    assert.equal(JSON.parse(body).errorCode, 'UPSTREAM_UNAVAILABLE');
  } finally { if (saved === undefined) delete process.env.FIRMS_MAP_KEY; else process.env.FIRMS_MAP_KEY = saved; }
});
