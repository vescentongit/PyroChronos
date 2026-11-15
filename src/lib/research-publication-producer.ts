import { z } from "zod";
import { researchAnalysisResultSchema } from "./research-contracts";
import {
	type P1AnalysisArtifact,
	type AnalysisPublication,
	analysisManifestSchema,
	analysisPublicationSchema,
} from "./research-foundation-contracts";
import type { PublicationContext } from "./research-publication-db";
import {
	canonicalJson,
	PublicationFailure,
	publicationChecksum,
} from "./research-publication-values";

export const publicationProducerSchema = z
	.object({
		result: researchAnalysisResultSchema,
		manifest: analysisManifestSchema,
	})
	.strict();

export function publicationScope(context: PublicationContext): string {
	return publicationChecksum(
		canonicalJson({
			workspaceId: context.job.workspaceId,
			jobId: context.job.id,
			attemptId: context.attempt.id,
		}),
	).slice(7);
}

export function publicationResultId(context: PublicationContext): string {
	return `result-${publicationScope(context)}`;
}

export function bindResearchProducer(
	producer: unknown,
	context: PublicationContext,
	artifacts: readonly P1AnalysisArtifact[],
	generatedAt: string,
	publishedAt: string,
): AnalysisPublication {
	const parsed = publicationProducerSchema.safeParse(producer);
	if (!parsed.success) throw new PublicationFailure("INVALID_OUTPUT");
	const { result, manifest } = parsed.data;
	for (const role of result.comparison
		? ["primary", "comparison"]
		: ["primary"]) {
		if (
			!artifacts.some(
				(artifact) =>
					artifact.kind === "observations" && artifact.periodRole === role,
			)
		)
			throw new PublicationFailure("INVALID_OUTPUT");
	}
	const area = context.job.input.area;
	if (
		result.method.manifestId !== manifest.id ||
		result.area.geometryHash !== area.geometryHash ||
		canonicalJson(result.area.geometry) !== canonicalJson(area.geometry)
	)
		throw new PublicationFailure("INVALID_OUTPUT");
	const scope = publicationScope(context);
	const manifestId = `manifest-${scope}`;
	const payload = {
		...result,
		id: publicationResultId(context),
		jobId: context.job.id,
		workspaceId: context.job.workspaceId,
		area,
		generatedAt,
		publishedAt,
		method: { ...result.method, manifestId },
	};
	const content = {
		...manifest,
		id: manifestId,
		jobId: context.job.id,
		workspaceId: context.job.workspaceId,
		areaId: area.id,
		areaRevision: area.revision,
	};
	const prepared = analysisPublicationSchema.safeParse({
		// Replay validation models the pre-commit package without resetting stored state.
		job: {
			...context.job,
			status: "running",
			resultId: null,
			completedAt: null,
		},
		attempt: {
			...context.attempt,
			status: "succeeded",
			completedAt: publishedAt,
		},
		manifest: content,
		result: {
			id: payload.id,
			jobId: payload.jobId,
			workspaceId: payload.workspaceId,
			manifestId,
			dataVersion: payload.dataVersion,
			generatedAt,
			publishedAt,
			payload,
		},
		artifacts,
	});
	if (!prepared.success) throw new PublicationFailure("INVALID_OUTPUT");
	return prepared.data;
}
