// Node-only download boundary. No database or storage writer is imported.
// Native HTTPS avoids Next fetch instrumentation logging credential URLs.
import { get as httpsGet } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { parse } from "csv-parse/sync";
import config from "../../config/firms.json" with { type: "json" };

type Failure = { ok: false; errorCode: string; retryable: boolean; httpStatus: number };
type Download = { ok: true; body: Buffer } | Failure;
type Downloader = (key: string, source: string, bbox: number[]) => Promise<Download>;
type RegionResolver = (id: string) => { bounds: number[] } | undefined;
const configuredRegion: RegionResolver = (id) => {
  if (!Object.hasOwn(config.regions, id)) return undefined;
  const ring = config.regions[id as keyof typeof config.regions].geometry.coordinates[0];
  const xs = ring.map((point) => point[0]), ys = ring.map((point) => point[1]);
  return { bounds: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
};
const errorCodes = new Set(["CONFIG_MISSING", "REGION_NOT_ALLOWED", "SOURCE_NOT_ALLOWED", "INVALID_REQUEST",
  "UPSTREAM_TIMEOUT", "UPSTREAM_REDIRECT", "UPSTREAM_RATE_LIMITED", "UPSTREAM_DENIED",
  "UPSTREAM_UNAVAILABLE", "INVALID_RESPONSE", "PAYLOAD_TOO_LARGE"]);
const fail = (errorCode: string, retryable = false, httpStatus = 502): Failure => ({
  ok: false, errorCode: errorCodes.has(errorCode) ? errorCode : "UPSTREAM_UNAVAILABLE",
  retryable: retryable === true, httpStatus: Number.isInteger(httpStatus) && httpStatus >= 400 && httpStatus <= 599 ? httpStatus : 502,
});

function validCsv(body: Buffer): boolean {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    if (!text || text.includes("\0")) return false;
    let header: string[] | undefined;
    const allowed = new Set([...config.requiredColumns, ...config.optionalColumns]);
    parse(text, { bom: true, max_record_size: 65536, on_record: (row: string[]) => {
      if (!header) {
        if (new Set(row).size !== row.length || !config.requiredColumns.every((column) => row.includes(column)) ||
            !row.every((column) => allowed.has(column))) throw new Error("INVALID_RESPONSE");
        header = row;
      } else if (row.length !== header.length) throw new Error("INVALID_RESPONSE");
      return null; // Validate rows without accumulating millions of row arrays.
    } });
    return header !== undefined;
  } catch {
    return false;
  }
}

export function downloadFirms(
  key: string, source: string, bbox: number[],
  options: { get?: typeof httpsGet; timeoutMs?: number; maxBytes?: number } = {},
): Promise<Download> {
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
  return new Promise((resolve) => {
    let settled = false;
    let outgoing: ClientRequest | undefined;
    let incoming: IncomingMessage | undefined;
    const finish = (result: Download) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!result.ok) { incoming?.destroy(); outgoing?.destroy(); }
      resolve(result);
    };
    const timer = setTimeout(() => finish(fail("UPSTREAM_TIMEOUT", true, 504)), options.timeoutMs ?? 20000);
    try {
      const url = new URL(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/${source}/${bbox.join(",")}/2`);
      outgoing = (options.get ?? httpsGet)(url, {
        headers: { Accept: "text/csv", "Accept-Encoding": "identity" }, agent: false,
      }, (response) => {
        incoming = response;
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) return finish(fail("UPSTREAM_REDIRECT"));
        if (status === 429) return finish(fail("UPSTREAM_RATE_LIMITED", true, 503));
        if (status === 401 || status === 403) return finish(fail("UPSTREAM_DENIED"));
        if (status !== 200) return finish(fail("UPSTREAM_UNAVAILABLE", status >= 500));
        const encoding = response.headers["content-encoding"];
        if (encoding && encoding !== "identity") return finish(fail("INVALID_RESPONSE"));
        const length = response.headers["content-length"];
        if (length && !/^\d+$/.test(length)) return finish(fail("INVALID_RESPONSE"));
        if (length && Number(length) > maxBytes) return finish(fail("PAYLOAD_TOO_LARGE"));
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          if (settled) return;
          size += chunk.length;
          if (size > maxBytes) return finish(fail("PAYLOAD_TOO_LARGE"));
          chunks.push(chunk);
        });
        response.once("error", () => finish(fail("INVALID_RESPONSE", true)));
        response.once("aborted", () => finish(fail("INVALID_RESPONSE", true)));
        response.once("close", () => { if (!settled) finish(fail("INVALID_RESPONSE", true)); });
        response.once("end", () => {
          if (settled) return;
          if (!response.complete || (length !== undefined && size !== Number(length)))
            return finish(fail("INVALID_RESPONSE", true));
          const body = Buffer.concat(chunks, size);
          if (body.includes(key) || body.includes(encodeURIComponent(key)) || !validCsv(body))
            return finish(fail("INVALID_RESPONSE"));
          finish({ ok: true, body });
        });
      });
      outgoing.once("error", () => finish(fail("UPSTREAM_UNAVAILABLE", true)));
    } catch {
      finish(fail("UPSTREAM_UNAVAILABLE", true));
    }
  });
}

export function createFirmsProxy(download: Downloader = downloadFirms, resolveRegion: RegionResolver = configuredRegion) {
  return async (request: Request): Promise<Response> => {
    const params = new URL(request.url).searchParams;
    const error = (failure: Failure) => {
      const safe = fail(failure.errorCode, failure.retryable, failure.httpStatus);
      return Response.json({ status: "unavailable", errorCode: safe.errorCode, retryable: safe.retryable },
        { status: safe.httpStatus, headers: { "Cache-Control": "no-store" } });
    };
    for (const name of params.keys()) {
      if (!["region", "source"].includes(name) || params.getAll(name).length !== 1)
        return error(fail("INVALID_REQUEST", false, 400));
    }
    const regionId = params.get("region") ?? "kalteng";
    const sourceId = params.get("source") ?? "VIIRS_NOAA20_NRT";
    if (!Object.hasOwn(config.regions, regionId)) return error(fail("REGION_NOT_ALLOWED", false, 400));
    if (!Object.hasOwn(config.sources, sourceId)) return error(fail("SOURCE_NOT_ALLOWED", false, 400));
    // The application supplies dev's shared region registry; IDs must still
    // pass the strict B2 allowlist before consulting that trusted resolver.
    const studyRegion = resolveRegion(regionId);
    if (!studyRegion) return error(fail("REGION_NOT_ALLOWED", false, 400));
    const key = process.env.FIRMS_MAP_KEY;
    if (!key || key.length > 256 || /[^\x21-\x7e]/.test(key)) return error(fail("CONFIG_MISSING", false, 503));
    try {
      const result = await download(key, sourceId, studyRegion.bounds);
      if (!result.ok) return error(result);
      if (result.body.includes(key) || result.body.includes(encodeURIComponent(key)))
        return error(fail("INVALID_RESPONSE"));
      return new Response(new Uint8Array(result.body), { headers: {
        "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="firms-${regionId}.csv"`,
        "X-Pyro-Source": sourceId, "X-Pyro-Calibration": "none",
      } });
    } catch {
      return error(fail("UPSTREAM_UNAVAILABLE", true));
    }
  };
}
