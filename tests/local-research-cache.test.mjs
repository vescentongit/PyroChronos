import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";

registerHooks({ resolve(specifier, context, next) {
  if (context.parentURL?.includes("/src/lib/") && specifier.startsWith("./") && !/\.[a-z]+$/i.test(specifier)) return next(`${specifier}.ts`, context);
  return next(specifier, context);
} });
const { getBundle, submitResearch, lastResearchResult, researchHistory } = await import("../src/lib/local-research-client.ts");
const example = JSON.parse(readFileSync("src/lib/fixtures/research-demo.json", "utf8"));
const records = new Map();
let reads = 0;
globalThis.indexedDB = { open() {
  const request = { result: {
    close() {},
    transaction() { return { objectStore() { return { get(id) {
      reads++;
      const operation = { result: structuredClone(records.get(id)) };
      queueMicrotask(() => operation.onsuccess());
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

test("rejected submissions preserve IndexedDB, localStorage history and last-result pointer", async t => {
  seed("preserved-old");
  const area=example.result.area;
  const history=[{id:"preserved-old",name:"Old",start:"2019-01-01",end:"2019-01-02"}];
  const local=new Map([["pyro-local-areas-v1",JSON.stringify({[area.id]:area})],["pyro-research-history-v1",JSON.stringify(history)],["pyro-last-research-v1","preserved-old"]]);
  const previous=globalThis.localStorage;
  globalThis.localStorage={getItem:key=>local.get(key)??null,setItem:(key,value)=>local.set(key,value)};
  t.after(()=>{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;});
  const beforeLocal=structuredClone(local),beforeRecords=structuredClone(records);
  const body={requestId:crypto.randomUUID(),areaId:area.id,areaRevision:area.revision,period:{start:"2019-01-01",end:"2019-01-02"},comparisonPeriod:null,baseline:{kind:"rolling-same-calendar-period",windowYears:10},referenceScale:"MODIS-equivalent",qualityPolicyVersion:"quality-policy-1",monitoringLocationId:null};
  for(const [code,status,retry]of [["CAPACITY_LIMIT",503,"2"],["RATE_LIMITED",429,"60"],["PAYLOAD_TOO_LARGE",413,null]]) {
    t.mock.method(globalThis,"fetch",async()=>Response.json({schemaVersion:"research-2",error:code,code,retryable:status!==413,requestId:body.requestId},{status,headers:retry?{"Retry-After":retry}:{}}));
    await assert.rejects(submitResearch(area.workspaceId,body,new AbortController().signal),error=>error.code===code&&(retry===null||error.retryAfter===Number(retry)));
    assert.deepEqual(local,beforeLocal);
    assert.deepEqual(records,beforeRecords);
    assert.equal((await lastResearchResult()).id,"preserved-old");
    assert.deepEqual(researchHistory(),history);
  }
  // Evict memory cache, then prove the old persisted record remains readable.
  for (const name of ["AbortError", "TimeoutError"]) {
    t.mock.method(globalThis,"fetch",async()=>{throw new DOMException("Synthetic interrupted request",name);});
    await assert.rejects(submitResearch(area.workspaceId,body,new AbortController().signal),error=>error.name===name);
    assert.deepEqual(local,beforeLocal);
    assert.deepEqual(records,beforeRecords);
    assert.equal((await lastResearchResult()).id,"preserved-old");
  }
  await getBundle("cache-active");
  assert.equal((await getBundle("preserved-old")).result.id,"preserved-old");
});
