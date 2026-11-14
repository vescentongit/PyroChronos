import { spawn } from "node:child_process";

type ProducerInput = { action: "fingerprint"; root?: string } | { root?: string; run: unknown };
const maxLocalBytes = 100_000_000;
// Keep hosted JSON bundles below Vercel's non-streaming response limit.
export const maxHostedBundleBytes = 4_000_000;

export async function researchProducer(input: ProducerInput, signal: AbortSignal): Promise<unknown> {
  const base = process.env.PIPELINE_URL;
  if (base) {
    const body = "run" in input ? { action: "produce", run: input.run } : { action: "fingerprint" };
    const response = await fetch(new URL("produce", base.endsWith("/") ? base : `${base}/`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
    });
    if (!response.body) throw new Error("PRODUCER_FAILED");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > maxHostedBundleBytes) throw new Error("CAPACITY_LIMIT");
        chunks.push(part.value);
      }
    } finally { await reader.cancel(); }
    let value: unknown;
    try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new Error("PRODUCER_FAILED"); }
    if (!response.ok) {
      const capacity = value && typeof value === "object" && "code" in value && value.code === "CAPACITY_LIMIT";
      throw new Error(capacity ? "CAPACITY_LIMIT" : "PRODUCER_FAILED");
    }
    return value;
  }
  // A missing binding on Vercel must never fall back to a nonexistent Python binary.
  if (process.env.VERCEL) throw new Error("PRODUCER_FAILED");
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.RESEARCH_PYTHON || "python", ["pipeline/research_worker.py"], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    const chunks: Buffer[] = [];
    let size = 0, done = false;
    const finish = (error?: Error, value?: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) { child.kill(); reject(error); } else resolve(value);
    };
    const abort = () => finish(new Error("ABORTED"));
    const timer = setTimeout(() => finish(new Error("TIMEOUT")), 120_000);
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxLocalBytes) finish(new Error("CAPACITY_LIMIT"));
      else chunks.push(chunk);
    });
    child.on("error", () => finish(new Error("PRODUCER_FAILED")));
    child.on("close", code => {
      if (code !== 0) return finish(new Error("PRODUCER_FAILED"));
      try { finish(undefined, JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { finish(new Error("PRODUCER_FAILED")); }
    });
    child.stdin.on("error", () => finish(new Error("PRODUCER_FAILED")));
    child.stdin.end(JSON.stringify(input));
    if (signal.aborted) abort();
  });
}
