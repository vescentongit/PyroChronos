import { z } from "zod";
import {
	canonicalJson,
	publicationChecksum,
	assertPublicationMetadataSafe,
	publicationSecrets,
} from "./research-publication-values.ts";
import type { researchPeriodSchema } from "./research-contracts.ts";

const checksum = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const id = z.string().min(1).max(200);
export const researchProducerConfigSchema = z
	.object({
		schemaVersion: z.literal("research-producer-config-1"),
		fingerprint: checksum,
		sources: z.array(id).min(1).max(16),
		archives: z.record(
			id,
			z
				.array(
					z
						.object({
							year: z.number().int().min(1990).max(2200),
							checksum: z.string().regex(/^[a-f0-9]{64}$/),
						})
						.strict(),
				)
				.max(250),
		),
		producerVersion: id,
		buildCommit: z.string().regex(/^[a-f0-9]{40}$/),
		mode: z.enum(["research", "replay", "demo"]),
		modelVersion: id,
		model: z
			.string()
			.max(4 * 1024 * 1024)
			.nullable(),
		baseline: z
			.string()
			.max(4 * 1024 * 1024)
			.nullable(),
		modelChecksum: checksum.nullable(),
		baselineChecksum: checksum.nullable(),
		policyChecksum: checksum,
		policyDocument: z.string().max(4 * 1024 * 1024),
		qualityPolicyVersion: id,
		satelliteConfigVersion: id,
		aggregationVersion: id,
		baselinePolicyVersion: id,
		minimumValidYears: z.number().int().positive().max(30),
	})
	.strict()
	.superRefine((config, issue) => {
		if (
			new Set(config.sources).size !== config.sources.length ||
			config.sources.some(
				(source) =>
					!config.archives[source] ||
					new Set(config.archives[source].map((a) => a.year)).size !==
						config.archives[source].length,
			)
		)
			issue.addIssue({
				code: "custom",
				message: "Source archive configuration is inconsistent",
			});
		for (const field of ["model", "baseline"] as const) {
			const content = config[field],
				hash = config[`${field}Checksum`];
			if (
				(content === null) !== (hash === null) ||
				(content !== null && publicationChecksum(content) !== hash)
			)
				issue.addIssue({
					code: "custom",
					message: "Frozen model/policy checksum mismatch",
				});
		}
		if (publicationChecksum(config.policyDocument) !== config.policyChecksum)
			issue.addIssue({
				code: "custom",
				message: "Frozen harmonization policy checksum mismatch",
			});
		try {
			for (const text of [config.model, config.baseline, config.policyDocument])
				if (text !== null)
					assertPublicationMetadataSafe(
						z.record(z.string(), z.unknown()).parse(JSON.parse(text)),
						publicationSecrets(),
					);
		} catch {
			issue.addIssue({
				code: "custom",
				message: "Invalid private producer configuration",
			});
		}
	});
export type ResearchProducerConfig = z.infer<
	typeof researchProducerConfigSchema
>;
export const producerMetadataSchema = z
	.object({
		nativeManifestChecksum: checksum,
		archiveFingerprint: checksum,
		modelChecksum: checksum.nullable(),
		baselineChecksum: checksum.nullable(),
		policyChecksum: checksum,
		archives: z
			.record(
				id,
				z.array(
					z
						.object({
							year: z.number().int(),
							checksum: z.string().regex(/^[a-f0-9]{64}$/),
						})
						.strict(),
				),
			)
			.optional(),
		harmonization: z.record(z.string(), z.unknown()).nullable(),
	})
	.strict();

const baselineProjection = z
	.object({
		policyVersion: id,
		kind: id,
		windowYears: z.number().int().positive(),
		minimumValidYears: z.number().int().positive(),
		statistic: id,
		scoreKind: id,
	})
	.strict();
const modelProjection = z
	.object({
		family: id,
		ratio: z.number().nullable(),
		ratios: z.record(id, z.number()).nullable(),
	})
	.strict();
const harmonizationProjection = z
	.object({
		configHash: id,
		evaluationId: id,
		referenceSource: id,
		inputSource: id,
		polygonSupported: z.boolean(),
		model: modelProjection,
		baseline: baselineProjection,
	})
	.strict();
export const exportProducerMetadataSchema = producerMetadataSchema
	.omit({ harmonization: true })
	.extend({ harmonization: harmonizationProjection.nullable() })
	.strict();
export function projectExportProducerMetadata(
	value: z.infer<typeof producerMetadataSchema>,
) {
	const native = value.harmonization;
	return exportProducerMetadataSchema.parse({
		...value,
		harmonization:
			native === null
				? null
				: harmonizationProjection
						.strip()
						.parse({
							...native,
							model: modelProjection.strip().parse(native.model),
							baseline: baselineProjection.strip().parse(native.baseline),
						}),
	});
}

export function scopedProducerVersions(
	config: ResearchProducerConfig,
	period: z.infer<typeof researchPeriodSchema>,
	comparison: z.infer<typeof researchPeriodSchema> | null,
) {
	const years = new Set<number>();
	for (const span of [period, comparison])
		if (span)
			for (
				let year = Number(span.start.slice(0, 4));
				year <= Number(span.end.slice(0, 4));
				year++
			)
				years.add(year);
	const sources = config.sources.map((source) => {
		const parts = config.archives[source]
			.filter((archive) => years.has(archive.year))
			.map((archive) => `${archive.year}:${archive.checksum}`)
			.sort();
		return `${source}:${parts.length ? publicationChecksum(parts.join("|")) : "None"}`;
	});
	return {
		dataVersion: `firms-detections-${publicationChecksum(sources.join("|")).slice(7, 19)}`,
		modelVersion: config.modelVersion,
		satelliteConfigVersion: config.satelliteConfigVersion,
		aggregationVersion: config.aggregationVersion,
	};
}

export function producerConfigurationKey(
	config: ResearchProducerConfig,
): string {
	return publicationChecksum(canonicalJson(config));
}
