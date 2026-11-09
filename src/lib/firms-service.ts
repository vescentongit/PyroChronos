import { createHash } from "node:crypto";
import { parseFirmsCsv } from "./firms-csv";
import type { Detection, HotspotQuery } from "./hotspots";

const TTL = 10 * 60000,
  MAX_STALE = 4 * 3600000;
type Batch = { rows: Detection[]; fetchedAt: string; checksum: string };
const batches = new Map<string, Batch>();
const pending = new Map<string, Promise<Batch>>();
let budget = { minute: 0, count: 0 };
export class FirmsError extends Error {
  constructor(
    public code: "RATE_LIMITED" | "DEPENDENCY_UNAVAILABLE" | "NOT_CONFIGURED",
    public status: number,
  ) {
    super(code);
  }
}
async function download(query: HotspotQuery, key: string): Promise<Batch> {
  const minute = Math.floor(Date.now() / 60000);
  if (budget.minute !== minute) budget = { minute, count: 0 };
  if (++budget.count > 20) throw new FirmsError("RATE_LIMITED", 429);
  const days = query.hours / 24 + 1;
  // One bounded global batch per feed/window is cached on the server; only viewport data reaches the browser.
  const response = await fetch(
    `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/${query.source}/world/${days}`,
    { cache: "no-store", signal: AbortSignal.timeout(25000) },
  );
  if (!response.ok)
    throw new FirmsError(
      response.status === 429 ? "RATE_LIMITED" : "DEPENDENCY_UNAVAILABLE",
      response.status === 429 ? 429 : 503,
    );
  const reader = response.body?.getReader();
  if (!reader) throw new FirmsError("DEPENDENCY_UNAVAILABLE", 503);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 12 * 1024 * 1024) throw new Error("Batch too large");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const buffer = Buffer.concat(chunks);
  const rows = parseFirmsCsv(
    new TextDecoder("utf-8", { fatal: true }).decode(buffer),
    query.source,
  );
  return {
    rows,
    fetchedAt: new Date().toISOString(),
    checksum: `sha256:${createHash("sha256").update(buffer).digest("hex")}`,
  };
}
export async function getFirmsBatch(query: HotspotQuery) {
  const key = process.env.FIRMS_MAP_KEY?.trim();
  if (!key) throw new FirmsError("NOT_CONFIGURED", 503);
  const id = `${query.source}:${query.hours}`;
  const cached = batches.get(id);
  if (
    cached &&
    cached.fetchedAt.slice(0, 10) === new Date().toISOString().slice(0, 10) &&
    Date.now() - Date.parse(cached.fetchedAt) < TTL
  )
    return { ...cached, status: "available" as const };
  try {
    let request = pending.get(id);
    if (!request) {
      request = download(query, key).then((batch) => {
        batches.delete(id);
        batches.set(id, batch);
        while (
          batches.size > 4 ||
          [...batches.values()].reduce(
            (total, item) => total + item.rows.length,
            0,
          ) > 200000
        ) {
          batches.delete(batches.keys().next().value!);
        }
        return batch;
      });
      pending.set(id, request);
      request
        .finally(() => {
          if (pending.get(id) === request) pending.delete(id);
        })
        .catch(() => {});
    }
    return { ...(await request), status: "available" as const };
  } catch (error) {
    if (cached && Date.now() - Date.parse(cached.fetchedAt) < MAX_STALE)
      return { ...cached, status: "stale" as const };
    if (error instanceof FirmsError) throw error;
    // Do not expose upstream URLs: FIRMS embeds the private key in its URL path.
    throw new FirmsError("DEPENDENCY_UNAVAILABLE", 503);
  }
}
export const firmsFreshUntil = (fetchedAt: string) =>
  new Date(Date.parse(fetchedAt) + TTL).toISOString();
