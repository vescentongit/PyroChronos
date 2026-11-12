import { z } from "zod";
import {
	researchAnalysisResultSchema,
	researchDetectionsPageSchema,
} from "./research-contracts";
import { analysisArtifactSchema } from "./research-foundation-contracts";
import { containsPoint } from "./research-server-geometry";
import { fail } from "./research-store";
import {
	canonicalJson,
	publicationChecksum,
} from "./research-publication-values";
import type { LocationDatabase } from "./monitoring-locations";

export interface ResearchArtifactReader {
	read(key: string, checksum: string, bytes: number): Promise<Uint8Array>;
}
export type PublishedAnalysis = z.infer<typeof researchAnalysisResultSchema>;
type Observation = z.infer<
	typeof researchDetectionsPageSchema
>["observations"][number];
const pagesSchema = z.union([
	researchDetectionsPageSchema,
	z.array(researchDetectionsPageSchema).min(1).max(128),
]);
const maxEvidenceBytes = 64 * 1024 * 1024;

export async function readPublishedAnalysis(
	db: LocationDatabase,
	workspaceId: string,
	analysisId: string,
): Promise<PublishedAnalysis> {
	const [row] = await db.query(
		`SELECT r.payload FROM "AnalysisResult" r
		JOIN "P1AnalysisJob" j ON j.id=r."jobId" AND j."workspaceId"=r."workspaceId"
		WHERE r.id=$1 AND r."workspaceId"=$2 AND j.status='succeeded' AND j."resultId"=r.id`,
		[analysisId, workspaceId],
	);
	if (!row) return fail("NOT_FOUND", 404);
	const result = researchAnalysisResultSchema.safeParse(row.payload);
	if (
		!result.success ||
		result.data.id !== analysisId ||
		result.data.workspaceId !== workspaceId
	)
		return fail("DEPENDENCY_UNAVAILABLE", 503);
	return result.data;
}

export async function findOriginalObservation(
	db: LocationDatabase,
	reader: ResearchArtifactReader,
	result: PublishedAnalysis,
	anchorId: string,
): Promise<Observation> {
	const rows = await db.query(
		`SELECT * FROM "P1AnalysisArtifact" WHERE "resultId"=$1 AND "workspaceId"=$2 AND kind='observations' ORDER BY id LIMIT 129`,
		[result.id, result.workspaceId],
	);
	if (!rows.length || rows.length > 128)
		return fail("DEPENDENCY_UNAVAILABLE", 503);
	let totalBytes = 0;
	let anchor: Observation | undefined;
	for (const row of rows) {
		const metadata = analysisArtifactSchema.safeParse({
			...row,
			bytes: Number(row.bytes),
		});
		if (!metadata.success || metadata.data.format !== "json")
			return fail("DEPENDENCY_UNAVAILABLE", 503);
		const artifact = metadata.data;
		totalBytes += artifact.bytes;
		if (totalBytes > maxEvidenceBytes)
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
				if (observation.id === anchorId) {
					if (anchor && canonicalJson(anchor) !== canonicalJson(observation))
						return fail("DEPENDENCY_UNAVAILABLE", 503);
					anchor = observation;
				}
			}
		}
	}
	return anchor ?? fail("NOT_FOUND", 404);
}
