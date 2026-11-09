import { createFirmsProxy } from "@/lib/firms-proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Download only. Persistence belongs exclusively to the private ingest job.
export const GET = createFirmsProxy();
