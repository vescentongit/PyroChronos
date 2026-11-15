import { readFile, realpath, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { readiness } from "../../../lib/research-deployment.ts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
	const result = await readiness(process.env, async () => {
		if (process.env.PIPELINE_URL) {
			const base = process.env.PIPELINE_URL;
			const response = await fetch(
				new URL("ready", base.endsWith("/") ? base : `${base}/`),
				{
					signal: AbortSignal.timeout(5000),
					cache: "no-store",
					redirect: "error",
				},
			);
			if (!response.ok || (await response.json()).status !== "ready")
				throw new Error("UNAVAILABLE");
		} else if (process.env.RESEARCH_DATA_DIR) {
			if (!(await stat(process.env.RESEARCH_DATA_DIR)).isDirectory())
				throw new Error("UNAVAILABLE");
			await Promise.any(["MODIS_SP", "VIIRS_SNPP_SP"].map(async source => {
				const manifest = await readFile(join(process.env.RESEARCH_DATA_DIR!, source, "manifest.jsonl"), "utf8");
				if (!manifest.split(/\r?\n/).filter(Boolean).some(line => JSON.parse(line).detections_format === "pcd1"))
					throw new Error("UNAVAILABLE");
			}));
		} else if (!process.env.FIRMS_MAP_KEY?.trim())
			throw new Error("UNAVAILABLE");
		// On-demand readiness checks configuration only, never consumes upstream quota.
		if (process.env.RESEARCH_V2_EXPERIMENTAL === "true") {
			const { getDb } = await import("../../../lib/db.ts");
			await getDb().$queryRaw`SELECT 1`;
			const [schema] = await getDb().$queryRaw<
				{ analyses: boolean; exports: boolean }[]
			>`SELECT to_regclass('"P1AnalysisJob"') IS NOT NULL AS analyses, to_regclass('"ResearchExport"') IS NOT NULL AS exports`;
			if (!schema?.analyses || !schema.exports) throw new Error("UNAVAILABLE");
			if (!(await stat(process.env.RESEARCH_ARTIFACT_ROOT || "")).isDirectory())
				throw new Error("UNAVAILABLE");
			if (
				relative(
					resolve(process.env.RESEARCH_ARTIFACT_ROOT || ""),
					await realpath(process.env.RESEARCH_ARTIFACT_ROOT || ""),
				) !== ""
			)
				throw new Error("UNAVAILABLE");
		}
	});
	return Response.json(result, {
		status: result.status === "ready" ? 200 : 503,
		headers: { "Cache-Control": "no-store" },
	});
}
