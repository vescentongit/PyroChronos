import { z } from "zod";
import type { Snapshot } from "./snapshot";

export type AnalysisOutputV1 = Omit<Snapshot, "publishedAt" | "freshUntil">;

const instant = z.string().datetime({ offset: true });
const regionId = z.enum(["kalteng", "papua"]);
const outcome = z.enum([
  "Api/asap ditemukan",
  "Tidak ditemukan tanda api saat pemeriksaan",
  "Belum dapat dipastikan",
]);
const fields = {
  observedAt: instant,
  result: outcome,
  notes: z.string().max(2000),
};
const actor = z.object({
  id: z.string().min(1),
  displayName: z.string().nullable(),
});

// Legacy v1 report contract; the research v2 target lives in research-contracts.ts.
export const createReportSchema = z
  .object({
    requestId: z.string().uuid(),
    candidateId: z.string().min(1),
    regionId,
    ...fields,
  })
  .strict();
export const correctReportSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedRevision: z.number().int().positive(),
    reason: z.string().trim().min(1).max(500),
    ...fields,
  })
  .strict();
export const reportResponseSchema = z.object({
  id: z.string().min(1),
  requestId: z.string().uuid(),
  candidateId: z.string().min(1),
  regionId,
  name: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  ...fields,
  createdAt: instant,
  updatedAt: instant,
  recorder: actor,
  revision: z.number().int().positive(),
  corrections: z.array(
    z.object({
      revision: z.number().int().positive(),
      ...fields,
      correctedAt: instant,
      correctedBy: actor,
      reason: z.string().min(1).max(500),
      requestId: z.string().uuid(),
    }),
  ),
});
export const apiErrorSchema = z.object({
  error: z.string().min(1),
  code: z.enum([
    "INVALID_REQUEST",
    "UNAUTHENTICATED",
    "FORBIDDEN",
    "NOT_FOUND",
    "SNAPSHOT_NOT_READY",
    "DEPENDENCY_UNAVAILABLE",
    "RATE_LIMITED",
    "IDEMPOTENCY_CONFLICT",
    "REVISION_CONFLICT",
    "INTERNAL_ERROR",
  ]),
  retryable: z.boolean(),
  requestId: z.string().nullable(),
});

export type CreateReport = z.infer<typeof createReportSchema>;
export type CorrectReport = z.infer<typeof correctReportSchema>;
export type InspectionReportV1 = z.infer<typeof reportResponseSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;
