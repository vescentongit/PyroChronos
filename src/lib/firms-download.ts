import { get } from "node:https";

export type FirmsFailureReason =
  | "NOT_CONFIGURED"
  | "NETWORK_ERROR"
  | "TIMEOUT"
  | "UPSTREAM_DENIED"
  | "RATE_LIMITED"
  | "INVALID_RESPONSE"
  | "PAYLOAD_TOO_LARGE"
  | "UPSTREAM_UNAVAILABLE";

export class FirmsError extends Error {
  code: "RATE_LIMITED" | "DEPENDENCY_UNAVAILABLE" | "NOT_CONFIGURED";
  status: number;
  reason: FirmsFailureReason;

  constructor(reason: FirmsFailureReason) {
    super(reason);
    this.reason = reason;
    this.code =
      reason === "RATE_LIMITED" || reason === "NOT_CONFIGURED"
        ? reason
        : "DEPENDENCY_UNAVAILABLE";
    this.status = reason === "RATE_LIMITED" ? 429 : 503;
  }
}

export function downloadFirmsCsv(url: URL): Promise<Buffer> {
  // Native HTTPS keeps the credential URL out of Next.js fetch diagnostics.
  return new Promise((resolve, reject) => {
    const request = get(url, { headers: { Accept: "text/csv" } });
    const timer = setTimeout(() => {
      reject(new FirmsError("TIMEOUT"));
      request.destroy();
    }, 25000);
    request.once("response", (response) => {
      const status = response.statusCode ?? 0;
      if (status !== 200) {
        reject(
          new FirmsError(
            status === 429
              ? "RATE_LIMITED"
              : status === 401 || status === 403
                ? "UPSTREAM_DENIED"
                : "UPSTREAM_UNAVAILABLE",
          ),
        );
        response.destroy();
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 12 * 1024 * 1024) {
          reject(new FirmsError("PAYLOAD_TOO_LARGE"));
          response.destroy();
        } else chunks.push(chunk);
      });
      response.once("error", (error) => {
        reject(
          error instanceof FirmsError ? error : new FirmsError("NETWORK_ERROR"),
        );
      });
      response.once("end", () => {
        if (!response.complete) reject(new FirmsError("NETWORK_ERROR"));
        else resolve(Buffer.concat(chunks));
      });
      response.once("close", () => {
        if (!response.complete) reject(new FirmsError("NETWORK_ERROR"));
      });
    });
    request.once("error", (error) => {
      reject(
        error instanceof FirmsError ? error : new FirmsError("NETWORK_ERROR"),
      );
    });
    request.once("close", () => {
      clearTimeout(timer);
      reject(new FirmsError("NETWORK_ERROR"));
    });
  });
}
