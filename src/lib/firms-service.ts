import { createHash } from "node:crypto";
import { parseFirmsCsv } from "./firms-csv";
import { downloadFirmsCsv, FirmsError } from "./firms-download";
import type { Detection, HotspotQuery } from "./hotspots";

export { FirmsError } from "./firms-download";

const TTL = 10 * 60000,
  MAX_STALE = 4 * 3600000;
type Batch = { rows: Detection[]; fetchedAt: string; checksum: string };
const batches = new Map<string, Batch>();
const pending = new Map<string, Promise<Batch>>();
let budget = { minute: 0, count: 0 };
async function download(query: HotspotQuery, key: string): Promise<Batch> {
  const [west, south, east, north] = query.bbox;
  // FIRMS expects west < east; split viewports crossing the date line.
  const areas =
    west > east
      ? [
          [west, south, 180, north],
          [-180, south, east, north],
        ].filter(([w, , e]) => w < e)
      : [query.bbox];
  const minute = Math.floor(Date.now() / 60000);
  if (budget.minute !== minute) budget = { minute, count: 0 };
  if (budget.count + areas.length > 20) throw new FirmsError("RATE_LIMITED");
  budget.count += areas.length;
  const days = query.hours / 24 + 1;
  const buffers = await Promise.all(
    areas.map((bounds) =>
      downloadFirmsCsv(
        new URL(
          `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/${query.source}/${bounds.join(",")}/${days}`,
        ),
      ),
    ),
  );
  const rows = new Map<string, Detection>();
  try {
    for (const buffer of buffers) {
      const csv = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      if (/^\s*(?:invalid|expired)\s+(?:map[_ ]?key|key)/i.test(csv))
        throw new FirmsError("UPSTREAM_DENIED");
      for (const row of parseFirmsCsv(csv, query.source)) rows.set(row.id, row);
    }
  } catch (error) {
    throw error instanceof FirmsError
      ? error
      : new FirmsError("INVALID_RESPONSE");
  }
  const hash = createHash("sha256");
  for (const buffer of buffers) hash.update(buffer);
  return {
    rows: [...rows.values()],
    fetchedAt: new Date().toISOString(),
    checksum: `sha256:${hash.digest("hex")}`,
  };
}
export async function getFirmsBatch(query: HotspotQuery) {
  const key = process.env.FIRMS_MAP_KEY?.trim();
  if (!key) throw new FirmsError("NOT_CONFIGURED");
  const id = `${query.source}:${query.hours}:${query.bbox.join(",")}`;
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
    throw new FirmsError("UPSTREAM_UNAVAILABLE");
  }
}
export const firmsFreshUntil = (fetchedAt: string) =>
  new Date(Date.parse(fetchedAt) + TTL).toISOString();
