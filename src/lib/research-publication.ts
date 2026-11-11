import { z } from "zod";
import {
	type P1AnalysisArtifact,
	analysisArtifactSchema,
} from "./research-foundation-contracts";
import {
	insertPublication,
	type PublicationContext,
	type PublicationDatabase,
	readPublicationContext,
	readStoredPublication,
} from "./research-publication-db";
import {
	bindResearchProducer,
	publicationProducerSchema,
	publicationScope,
} from "./research-publication-producer";
import type { PrivateResearchArtifactStorage } from "./research-publication-storage";
import {
	assertPublicationMetadataSafe,
	assertPublicationSafe,
	canonicalJson,
	PublicationFailure,
	publicationChecksum,
	publicationFailure,
	publicationSecrets,
} from "./research-publication-values";

export { PublicationFailure } from "./research-publication-values";

const artifactInput = analysisArtifactSchema
	.pick({
		kind: true,
		periodRole: true,
		format: true,
		checksum: true,
		bytes: true,
	})
	.extend({ content: z.instanceof(Uint8Array) })
	.strict();
const requestSchema = z
	.object({
		claim: z
			.object({
				jobId: z.string().min(1).max(200),
				workspaceId: z.string().min(1).max(200),
				attemptId: z.string().min(1).max(200),
				leaseToken: z.string().uuid(),
			})
			.strict(),
		producer: z.unknown(),
		artifacts: z.array(artifactInput),
	})
	.strict();

export interface ResearchPublicationDependencies {
	database: PublicationDatabase;
	storage: PrivateResearchArtifactStorage;
	secrets?: readonly string[];
	log?: (event: { status: "succeeded" | "failed"; code?: string }) => void;
}
export interface ResearchPublicationReceipt {
	resultId: string;
	manifestId: string;
	reused: boolean;
}

function requireOwner(context: PublicationContext, replay = false): void {
	if (
		replay &&
		context.job.status === "succeeded" &&
		context.attempt.status === "succeeded"
	)
		return;
	if (
		context.job.status !== "running" ||
		context.attempt.status !== "running" ||
		Date.parse(context.now) >= Date.parse(context.attempt.leaseExpiresAt)
	)
		throw new PublicationFailure("LEASE_LOST");
}

function metadataFor(
	artifacts: z.infer<typeof artifactInput>[],
	context: PublicationContext,
): P1AnalysisArtifact[] {
	const scope = publicationScope(context);
	return artifacts.map((artifact) => {
		if (
			artifact.bytes !== artifact.content.byteLength ||
			publicationChecksum(artifact.content) !== artifact.checksum
		)
			throw new PublicationFailure("ARTIFACT_MISMATCH");
		const objectKey = `research/${scope}/${artifact.kind}-${artifact.periodRole}-${artifact.checksum.slice(7)}.${artifact.format}`;
		return analysisArtifactSchema.parse({
			id: `artifact-${publicationChecksum(objectKey).slice(7)}`,
			resultId: `result-${scope}`,
			workspaceId: context.job.workspaceId,
			objectKey,
			kind: artifact.kind,
			periodRole: artifact.periodRole,
			checksum: artifact.checksum,
			bytes: artifact.bytes,
			format: artifact.format,
		});
	});
}

async function verifyAll(
	storage: PrivateResearchArtifactStorage,
	artifacts: readonly P1AnalysisArtifact[],
): Promise<void> {
	try {
		for (const artifact of artifacts)
			await storage.verify(
				artifact.objectKey,
				artifact.checksum,
				artifact.bytes,
			);
	} catch (error: unknown) {
		throw publicationFailure(error, "STORAGE_FAILED");
	}
}

export async function publishResearchResult(
	dependencies: ResearchPublicationDependencies,
	input: unknown,
): Promise<ResearchPublicationReceipt> {
	const log = (
		event: Parameters<NonNullable<ResearchPublicationDependencies["log"]>>[0],
	) => {
		try {
			dependencies.log?.(event);
		} catch {
			/* Logging cannot undo a committed publication. */
		}
	};
	try {
		const parsed = requestSchema.safeParse(input);
		if (!parsed.success) throw new PublicationFailure("INVALID_OUTPUT");
		const producer = publicationProducerSchema.safeParse(parsed.data.producer);
		if (!producer.success) throw new PublicationFailure("INVALID_OUTPUT");
		const request = {
			...parsed.data,
			producer: producer.data,
			artifacts: parsed.data.artifacts.map((artifact) => ({
				...artifact,
				content: Uint8Array.from(artifact.content),
			})),
		};
		const secrets = publicationSecrets([
			...(dependencies.secrets ?? []),
			request.claim.leaseToken,
		]);
		assertPublicationMetadataSafe(request.producer, secrets);
		for (const artifact of request.artifacts) {
			assertPublicationSafe(artifact.content, secrets);
			if (artifact.format === "json" || artifact.format === "geojson") {
				let document: unknown;
				try {
					document = JSON.parse(Buffer.from(artifact.content).toString("utf8"));
				} catch {
					throw new PublicationFailure("INVALID_OUTPUT");
				}
				assertPublicationMetadataSafe(document, secrets);
			}
		}
		let initial: PublicationContext;
		try {
			initial = await readPublicationContext(
				dependencies.database,
				request.claim,
			);
		} catch (error: unknown) {
			throw publicationFailure(error, "DATABASE_FAILED");
		}
		requireOwner(initial, true);
		assertPublicationMetadataSafe(initial.job.input, secrets);
		const metadata = metadataFor(request.artifacts, initial);
		assertPublicationMetadataSafe(metadata, secrets);

		if (initial.job.status === "running") {
			bindResearchProducer(
				request.producer,
				initial,
				metadata,
				initial.now,
				initial.now,
			);
			try {
				for (let index = 0; index < metadata.length; index++) {
					await dependencies.storage.put(
						metadata[index].objectKey,
						request.artifacts[index].content,
					);
				}
			} catch (error: unknown) {
				throw publicationFailure(error, "STORAGE_FAILED");
			}
			await verifyAll(dependencies.storage, metadata);
		}

		let receipt: ResearchPublicationReceipt;
		try {
			receipt = await dependencies.database.transaction(async (tx) => {
				const context = await readPublicationContext(tx, request.claim, true);
				requireOwner(context, true);
				if (context.job.status === "succeeded") {
					const stored = await readStoredPublication(tx, context.job.id);
					const retry = bindResearchProducer(
						request.producer,
						context,
						metadata,
						stored.result.payload.generatedAt,
						stored.result.payload.publishedAt,
					);
					if (
						canonicalJson(retry.result.payload) !==
							canonicalJson(stored.result.payload) ||
						canonicalJson(retry.manifest) !== canonicalJson(stored.manifest) ||
						canonicalJson(
							[...metadata].sort((a, b) => a.id.localeCompare(b.id)),
						) !== canonicalJson(stored.artifacts)
					)
						throw new PublicationFailure("PUBLICATION_CONFLICT");
					await verifyAll(dependencies.storage, stored.artifacts);
					return {
						resultId: stored.result.id,
						manifestId: stored.manifest.id,
						reused: true,
					};
				}
				const prepared = bindResearchProducer(
					request.producer,
					context,
					metadata,
					initial.now,
					context.now,
				);
				await verifyAll(dependencies.storage, metadata);
				await insertPublication(tx, prepared);
				return {
					resultId: prepared.result.id,
					manifestId: prepared.manifest.id,
					reused: false,
				};
			});
		} catch (error: unknown) {
			throw publicationFailure(error, "DATABASE_FAILED");
		}
		log({ status: "succeeded" });
		return receipt;
	} catch (error: unknown) {
		const failure = publicationFailure(error, "INVALID_OUTPUT");
		log({ status: "failed", code: failure.code });
		throw failure;
	}
}
