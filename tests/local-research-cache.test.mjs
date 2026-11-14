import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";

registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes("/src/lib/") && specifier.startsWith("./") && !/\.[a-z]+$/i.test(specifier)) return next(`${specifier}.ts`, context);
  return next(specifier, context);
} });
const { getBundle, openResearchResult } = await import("../src/lib/local-research-client.ts");
const example = JSON.parse(readFileSync("src/lib/fixtures/research-demo.json", "utf8"));
const records = new Map();
let reads = 0;
let delayedId, releaseRead;
globalThis.indexedDB = { open() {
  const request = { result: {
    close() {},
    transaction() { return { objectStore() { return { get(id) {
      reads++;
      const operation = { result: structuredClone(records.get(id)) };
      if (id === delayedId) releaseRead = () => operation.onsuccess();
      else queueMicrotask(() => operation.onsuccess());
      return operation;
    } }; } }; },
  } };
  queueMicrotask(() => request.onsuccess());
  return request;
} };
function seed(id) {
  const result = structuredClone(example.result);
  result.id = id;
  records.set(id, { result, manifest: { synthetic: true }, days: [], detections: [] });
}

test("active immutable bundle is read and validated once across concurrent detail requests", async () => {
  seed("cache-active");
  const before = reads;
  const [first, concurrent] = await Promise.all([getBundle("cache-active"), getBundle("cache-active")]);
  assert.equal(reads - before, 1);
  assert.equal(first, concurrent);
  assert.equal(await getBundle("cache-active"), first);
  assert.equal(reads - before, 1);
});
test("switching analyses evicts the previous cached bundle", async () => {
  seed("cache-other");
  await getBundle("cache-other");
  const before = reads;
  await getBundle("cache-active");
  assert.equal(reads - before, 1);
});
test("failed reads are not cached and do not replace a recoverable stored result", async () => {
  await assert.rejects(getBundle("cache-missing"), error => error.code === "INVALID_RESPONSE");
  seed("cache-missing");
  const before = reads;
  const result = await getBundle("cache-missing");
  assert.equal(result.result.id, "cache-missing");
  assert.equal(reads - before, 1);
});

test("rapid saved-result selections keep the latest choice when an earlier read is slow", async () => {
  seed("selection-slow"); seed("selection-latest");
  const previous = globalThis.localStorage;
  const metadata = new Map();
  globalThis.localStorage = { setItem: (key, value) => metadata.set(key, value) };
  delayedId = "selection-slow";
  try {
    const earlier = openResearchResult("selection-slow");
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(releaseRead);
    await openResearchResult("selection-latest");
    releaseRead();
    await earlier;
    assert.equal(metadata.get("pyro-last-research-v1"), "selection-latest");
  } finally { globalThis.localStorage = previous; delayedId = undefined; }
});
