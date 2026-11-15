import { createFirmsProxy } from "@/lib/firms-proxy";
import { getRegion } from "@/lib/regions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Download only. Persistence belongs exclusively to the private ingest job.
export const GET = createFirmsProxy(undefined, getRegion);
