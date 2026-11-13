import { z } from "zod";
import {
	researchAnalysisResultSchema,
	researchDetectionsPageSchema,
} from "./research-contracts.ts";
import { analysisArtifactSchema } from "./research-foundation-contracts.ts";
import { containsPoint } from "./research-server-geometry.ts";
import { fail } from "./research-store.ts";
import {
	canonicalJson,
	publicationChecksum,
} from "./research-publication-values.ts";
import type { LocationDatabase } from "./monitoring-locations.ts";

export interface ResearchArtifactReader {
	read(key: string, checksum: string, bytes: number): Promise<Uint8Array>;
}
export type PublishedAnalysis = z.infer<typeof researchAnalysisResultSchema>;
export type ResearchObservation = z.infer<
	typeof researchDetectionsPageSchema
>["observations"][number];
const pagesSchema = z.union([
	researchDetectionsPageSchema,
	z.array(researchDetectionsPageSchema).min(1).max(128),
]);

export async function readPublishedAnalysis(
	db: LocationDatabase,
	workspaceId: string,
	analysisId: string,
): Promise<PublishedAnalysis> {
	const [row] = await db.query(
		`SELECT r.payload FROM "AnalysisResult" r JOIN "P1AnalysisJob" j ON j.id=r."jobId" AND j."workspaceId"=r."workspaceId"
		WHERE r.id=$1 AND r."workspaceId"=$2 AND j.status='succeeded' AND j."resultId"=r.id`,
		[analysisId, workspaceId],
	);
	if (!row) return fail("NOT_FOUND", 404);
	const parsed = researchAnalysisResultSchema.safeParse(row.payload);
	if (
		!parsed.success ||
		parsed.data.id !== analysisId ||
		parsed.data.workspaceId !== workspaceId
	)
		return fail("DEPENDENCY_UNAVAILABLE", 503);
	return parsed.data;
}

export async function* iterateResearchObservations(
	db: LocationDatabase,
	reader: ResearchArtifactReader,
	result: PublishedAnalysis,
	options: {
		periodRole?: "primary" | "comparison";
		maxBytes?: number;
		maxObservations?: number;
	} = {},
): AsyncGenerator<ResearchObservation> {
	const rows = await db.query(
		`SELECT * FROM "P1AnalysisArtifact" WHERE "resultId"=$1 AND "workspaceId"=$2 AND kind='observations'
		AND ($3::text IS NULL OR "periodRole"=$3) ORDER BY id LIMIT 129`,
		[result.id, result.workspaceId, options.periodRole ?? null],
	);
	if (!rows.length || rows.length > 128)
		return fail("DEPENDENCY_UNAVAILABLE", 503);
	let totalBytes = 0;
	const seen = new Map<string, string>();
	for (const row of rows) {
		const metadata = analysisArtifactSchema.safeParse({
			...row,
			bytes: Number(row.bytes),
		});
		if (!metadata.success || metadata.data.format !== "json")
			return fail("DEPENDENCY_UNAVAILABLE", 503);
		const artifact = metadata.data;
		totalBytes += artifact.bytes;
		if (totalBytes > (options.maxBytes ?? 64 * 1024 * 1024))
			return fail("DEPENDENCY_UNAVAILABLE", 503);
		let document: unknown;
		try {
			const bytes = await reader.read(
				artifact.objectKey,
				artifact.checksum,
				artifact.bytes,
			);
			if (
				bytes.byteLength !== artifact.bytes ||
				publicationChecksum(bytes) !== artifact.checksum
			)
				return fail("DEPENDENCY_UNAVAILABLE", 503);
			document = JSON.parse(Buffer.from(bytes).toString("utf8"));
		} catch {
			return fail("DEPENDENCY_UNAVAILABLE", 503);
		}
		const parsed = pagesSchema.safeParse(document);
		if (!parsed.success) return fail("DEPENDENCY_UNAVAILABLE", 503);
		for (const page of Array.isArray(parsed.data)
			? parsed.data
			: [parsed.data]) {
			const period =
				page.periodRole === "primary"
					? result.primary.period
					: result.comparison?.period;
			if (
				page.analysisId !== result.id ||
				page.periodRole !== artifact.periodRole ||
				(options.periodRole && page.periodRole !== options.periodRole) ||
				!period
			)
				return fail("DEPENDENCY_UNAVAILABLE", 503);
			for (const observation of page.observations) {
				const date = new Date(observation.observedAt)
					.toISOString()
					.slice(0, 10);
				if (
					!result.sources.some(
						(source) => source.id === observation.sourceId,
					) ||
					date < period.start ||
					date > period.end ||
					!containsPoint(result.area.geometry, observation.coordinates)
				)
					return fail("DEPENDENCY_UNAVAILABLE", 503);
				const checksum = publicationChecksum(canonicalJson(observation));
				const previous = seen.get(observation.id);
				if (previous && previous !== checksum)
					return fail("DEPENDENCY_UNAVAILABLE", 503);
				if (previous) continue;
				seen.set(observation.id, checksum);
				if (seen.size > (options.maxObservations ?? 1_000_000))
					return fail("CAPACITY_LIMIT", 503);
				yield observation;
			}
		}
	}
}
