import { z } from "zod";
import {
	analysisArtifactSchema,
	type P1AnalysisArtifact,
} from "./research-foundation-contracts.ts";
import {
	iterateObservationArtifacts,
	researchObservationPagesSchema,
	type PublishedAnalysis,
} from "./research-observations.ts";
import {
	canonicalJson,
	publicationChecksum,
	PublicationFailure,
} from "./research-publication-values.ts";

export const publicationArtifactInputSchema = analysisArtifactSchema
	.pick({
		kind: true,
		periodRole: true,
		format: true,
		checksum: true,
		bytes: true,
	})
	.extend({ content: z.instanceof(Uint8Array) })
	.strict();
type ArtifactInput = z.infer<typeof publicationArtifactInputSchema>;

export function bindPublicationArtifacts(
	artifacts: readonly ArtifactInput[],
	producerResultId: string,
	resultId: string,
): ArtifactInput[] {
	return artifacts.map((artifact) => {
		if (
			artifact.bytes !== artifact.content.byteLength ||
			publicationChecksum(artifact.content) !== artifact.checksum
		)
			throw new PublicationFailure("ARTIFACT_MISMATCH");
		if (artifact.kind !== "observations") return artifact;
		try {
			if (artifact.format !== "json")
				throw new PublicationFailure("INVALID_OUTPUT");
			const document: unknown = JSON.parse(
				Buffer.from(artifact.content).toString("utf8"),
			);
			const parsed = researchObservationPagesSchema.parse(document);
			const pages = Array.isArray(parsed) ? parsed : [parsed];
			if (
				pages.some(
					(page) =>
						(page.analysisId !== producerResultId &&
							page.analysisId !== resultId) ||
						page.periodRole !== artifact.periodRole,
				)
			)
				throw new PublicationFailure("INVALID_OUTPUT");
			const bound = pages.map((page) => ({ ...page, analysisId: resultId }));
			const content = Buffer.from(
				canonicalJson(Array.isArray(parsed) ? bound : bound[0]),
			);
			return {
				...artifact,
				content,
				bytes: content.byteLength,
				checksum: publicationChecksum(content),
			};
		} catch {
			throw new PublicationFailure("INVALID_OUTPUT");
		}
	});
}

export async function validatePublicationObservations(
	result: PublishedAnalysis,
	metadata: readonly P1AnalysisArtifact[],
	artifacts: readonly ArtifactInput[],
): Promise<void> {
	const content = new Map(
		metadata.map((item, index) => [item.objectKey, artifacts[index].content]),
	);
	try {
		for await (const observation of iterateObservationArtifacts(
			metadata.filter((item) => item.kind === "observations"),
			{
				read: async (key) =>
					content.get(key) ??
					Promise.reject(new PublicationFailure("INVALID_OUTPUT")),
			},
			result,
		)) {
			void observation;
		}
		for (const role of result.comparison
			? (["primary", "comparison"] as const)
			: (["primary"] as const)) {
			const seen = new Set<string>();
			const counts = new Map<string, number>();
			for (const artifact of artifacts.filter(
				(item) => item.kind === "observations" && item.periodRole === role,
			)) {
				const parsed = researchObservationPagesSchema.parse(
					JSON.parse(Buffer.from(artifact.content).toString("utf8")),
				);
				for (const page of Array.isArray(parsed) ? parsed : [parsed]) {
					for (const observation of page.observations) {
						if (seen.has(observation.id)) continue;
						seen.add(observation.id);
						counts.set(
							observation.sourceId,
							(counts.get(observation.sourceId) ?? 0) + 1,
						);
					}
				}
			}
			const metric = (role === "primary" ? result.primary : result.comparison)
				?.metric;
			if (
				!metric ||
				seen.size !== (metric.rawCount ?? 0) ||
				Object.entries(metric.rawCountsBySource).some(
					([source, count]) => (counts.get(source) ?? 0) !== (count ?? 0),
				)
			)
				throw new PublicationFailure("INVALID_OUTPUT");
		}
	} catch {
		throw new PublicationFailure("INVALID_OUTPUT");
	}
}
