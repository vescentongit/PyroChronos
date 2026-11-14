import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { researchProducer, maxHostedBundleBytes } from "../src/lib/research-producer.ts";

test("Vercel exposes only app and injects the pipeline binding on its caller", () => {
  const config = JSON.parse(readFileSync("vercel.json", "utf8"));
  assert.deepEqual(config.services.app.bindings, [{ type: "service", service: "pipeline", format: "url", env: "PIPELINE_URL" }]);
  assert.deepEqual(config.rewrites, [{ source: "/(.*)", destination: { service: "app" } }]);
  assert.equal(config.services.pipeline.entrypoint, "app:app");
  for (const key of ["functions", "installCommand", "buildCommand", "devCommand", "ignoreCommand", "outputDirectory", "framework"]) assert.equal(config[key], undefined);
});

test("producer uses the runtime binding, strips local paths, and bounds responses", async () => {
  const originalFetch = globalThis.fetch;
  const previous = process.env.PIPELINE_URL;
  process.env.PIPELINE_URL = "https://internal.invalid/pipeline-base";
  const signal = new AbortController().signal;
  const calls = [];
  try {
    globalThis.fetch = async (url, options) => {
      calls.push({ url: url.href, ...options });
      return Response.json("sha256:" + "a".repeat(64));
    };
    await researchProducer({ action: "fingerprint", root: "private-local-path" }, signal);
    assert.equal(calls[0].url, "https://internal.invalid/pipeline-base/produce");
    assert.deepEqual(JSON.parse(calls[0].body), { action: "fingerprint" });
    assert.equal(calls[0].cache, "no-store");
    assert.equal(calls[0].redirect, "error");
    await researchProducer({ root: "private-local-path", run: { id: "run" } }, signal);
    assert.deepEqual(JSON.parse(calls[1].body), { action: "produce", run: { id: "run" } });

    for (const [response, expected] of [
      [Response.json({ code: "CAPACITY_LIMIT" }, { status: 503 }), "CAPACITY_LIMIT"],
      [Response.json({ detail: "private server details" }, { status: 500 }), "PRODUCER_FAILED"],
      [new Response("not JSON"), "PRODUCER_FAILED"],
      [new Response("x".repeat(maxHostedBundleBytes + 1)), "CAPACITY_LIMIT"],
    ]) {
      globalThis.fetch = async () => response;
      await assert.rejects(researchProducer({ action: "fingerprint" }, signal), { message: expected });
    }
    globalThis.fetch = async (_url, options) => {
      options.signal.throwIfAborted();
      throw new Error("should have aborted");
    };
    await assert.rejects(researchProducer({ action: "fingerprint" }, AbortSignal.abort()));
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) delete process.env.PIPELINE_URL; else process.env.PIPELINE_URL = previous;
  }
});

test("Vercel with a missing binding never tries the local Python fallback", async () => {
  const previous = { vercel: process.env.VERCEL, url: process.env.PIPELINE_URL };
  process.env.VERCEL = "1";
  delete process.env.PIPELINE_URL;
  try {
    await assert.rejects(researchProducer({ action: "fingerprint" }, new AbortController().signal), { message: "PRODUCER_FAILED" });
  } finally {
    if (previous.vercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = previous.vercel;
    if (previous.url === undefined) delete process.env.PIPELINE_URL; else process.env.PIPELINE_URL = previous.url;
  }
});
