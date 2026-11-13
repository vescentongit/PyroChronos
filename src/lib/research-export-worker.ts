import { randomUUID } from "node:crypto";
import type { LocationDatabase } from "./monitoring-locations.ts";
import { fail, ResearchFailure } from "./research-store.ts";
import {
	assertPublicationMetadataSafe,
	canonicalJson,
	publicationChecksum,
} from "./research-publication-values.ts";
import { iterateResearchObservations } from "./research-observations.ts";
import {
	readExportSource,
	exportSecretValues,
	buildExportManifest,
} from "./research-export-manifest.ts";
import {
	exportArtifactSchema,
	researchExportManifestSchema,
	type ResearchExportArtifact,
	type ResearchExportClaim,
} from "./research-export-contracts.ts";
import {
	claimResearchExport,
	heartbeatResearchExport,
	failResearchExport,
	lockResearchExportClaim,
	type ExportLeasePolicy,
} from "./research-export-queue.ts";
import {
	formatResearchExport,
	researchExportFormatterVersion,
	type ExportFormatter,
} from "./research-export-format.ts";
import type { ResearchExportDependencies } from "./research-exports.ts";
import {
	readVerifiedExportObject,
	type ResearchExportStorage,
} from "./research-export-storage.ts";
import { assertExportCsvSafe } from "./research-export-security.ts";

async function publishExport(
	db: LocationDatabase,
	storage: ResearchExportStorage,
	claim: ResearchExportClaim,
	artifacts: ResearchExportArtifact[],
): Promise<boolean> {
	return db.transaction(async (tx) => {
		if (!(await lockResearchExportClaim(tx, claim))) return false;
		const csv = artifacts.find((artifact) => artifact.kind === "csv");
		const manifest = artifacts.find((artifact) => artifact.kind === "manifest");
		if (!csv || !manifest || csv.rowCount === null)
			return fail("DEPENDENCY_UNAVAILABLE", 503);
		const expected = await buildExportManifest(tx, claim.job, {
			checksum: csv.checksum,
			bytes: csv.bytes,
			rowCount: csv.rowCount,
		});
		const stored = researchExportManifestSchema.parse(
			JSON.parse(
				Buffer.from(await readVerifiedExportObject(storage, manifest)).toString(
					"utf8",
				),
			),
		);
		if (canonicalJson(stored) !== canonicalJson(expected))
			return fail("DEPENDENCY_UNAVAILABLE", 503);
		await assertExportCsvSafe(
			await readVerifiedExportObject(storage, csv),
			await exportSecretValues(tx, claim.job),
			csv.rowCount,
		);
		for (const artifact of artifacts) {
			await storage.verify(
				artifact.objectKey,
				artifact.checksum,
				artifact.bytes,
			);
			await tx.query(
				`INSERT INTO "ResearchExportArtifact" (id,"exportId","workspaceId","attemptId",kind,"objectKey",checksum,bytes,"rowCount") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
				[
					artifact.id,
					artifact.exportId,
					artifact.workspaceId,
					artifact.attemptId,
					artifact.kind,
					artifact.objectKey,
					artifact.checksum,
					artifact.bytes,
					artifact.rowCount,
				],
			);
		}
		const [attempt] = await tx.query(
			'UPDATE "ResearchExportAttempt" SET status=\'succeeded\',"completedAt"=clock_timestamp() WHERE id=$1 AND "leaseToken"=$2::uuid AND status=\'running\' AND "leaseExpiresAt">clock_timestamp() RETURNING id',
			[claim.attempt.id, claim.attempt.leaseToken],
		);
		if (!attempt) return fail("RESULT_NOT_READY", 409);
		const [job] = await tx.query(
			`UPDATE "ResearchExport" SET status='ready',"completedAt"=clock_timestamp(),"resultAttemptId"=$1 WHERE id=$2 AND status='running'
			AND EXISTS(SELECT 1 FROM "ResearchExportAttempt" WHERE id=$1 AND "leaseExpiresAt">clock_timestamp()) RETURNING id`,
			[claim.attempt.id, claim.job.id],
		);
		if (!job) return fail("RESULT_NOT_READY", 409);
		return true;
	});
}

export interface ResearchExportWorkerDependencies
	extends ResearchExportDependencies {
	formatter?: ExportFormatter;
	policy?: ExportLeasePolicy;
	timeoutMs?: number;
	signal?: AbortSignal;
}
export async function runResearchExportOnce(
	dependencies: ResearchExportWorkerDependencies,
) {
	const claim = await claimResearchExport(
		dependencies.database,
		dependencies.policy,
	);
	if (!claim) return { status: "idle" as const };
	const { job, attempt } = claim;
	const controller = new AbortController();
	const signal = dependencies.signal
		? AbortSignal.any([controller.signal, dependencies.signal])
		: controller.signal;
	let lost = false;
	let heartbeat: Promise<void> | undefined;
	const timer = setInterval(
		() => {
			if (heartbeat) return;
			heartbeat = heartbeatResearchExport(
				dependencies.database,
				claim,
				dependencies.policy,
			)
				.then((alive) => {
					if (!alive) {
						lost = true;
						controller.abort();
					}
				})
				.catch(() => {
					lost = true;
					controller.abort();
				})
				.finally(() => {
					heartbeat = undefined;
				});
		},
		Math.max(20, (dependencies.policy?.leaseSeconds ?? 60) * 250),
	);
	const timeout = setTimeout(
		() => controller.abort(),
		dependencies.timeoutMs ?? 120_000,
	);
	try {
		if ((await researchExportFormatterVersion()) !== job.formatterVersion)
			return fail("DEPENDENCY_UNAVAILABLE", 503);
		const source = await readExportSource(
			dependencies.database,
			job.workspaceId,
			job.analysisId,
		);
		if (
			source.analysisChecksum !== job.analysisChecksum ||
			source.manifestChecksum !== job.manifestChecksum
		)
			return fail("DEPENDENCY_UNAVAILABLE", 503);
		const secrets = await exportSecretValues(dependencies.database, job);
		assertPublicationMetadataSafe(
			{
				result: source.result,
				sourceManifest: source.manifest,
				snapshot: job.inspectionSnapshot,
			},
			secrets,
		);
		let rowCount =
			job.kind === "harmonized_aggregates_csv"
				? 1 + (job.periodRole === "primary" ? source.result.months.length : 0)
				: 0;
		async function* observations() {
			const counts = new Map<string, number>();
			for await (const observation of iterateResearchObservations(
				dependencies.database,
				dependencies.storage,
				source.result,
				{ periodRole: job.periodRole, maxBytes: 256 * 1024 * 1024 },
			)) {
				signal.throwIfAborted();
				assertPublicationMetadataSafe(observation, secrets);
				rowCount++;
				counts.set(
					observation.sourceId,
					(counts.get(observation.sourceId) ?? 0) + 1,
				);
				yield observation;
			}
			const metric =
				job.periodRole === "primary"
					? source.result.primary.metric
					: source.result.comparison?.metric;
			if (
				!metric ||
				(metric.rawCount === null
					? rowCount !== 0
					: metric.rawCount !== rowCount) ||
				Object.entries(metric.rawCountsBySource).some(
					([id, count]) => (count ?? 0) !== (counts.get(id) ?? 0),
				)
			)
				return fail("DEPENDENCY_UNAVAILABLE", 503);
		}
		const scope = publicationChecksum(
			canonicalJson({
				exportId: job.id,
				attemptId: attempt.id,
				workspaceId: job.workspaceId,
			}),
		).slice(7);
		const csvKey = `exports/${scope}/data.csv`,
			manifestKey = `exports/${scope}/manifest.json`;
		const csv = await dependencies.storage.putStream(
			csvKey,
			(dependencies.formatter ?? formatResearchExport)({
				job,
				result: source.result,
				observations: observations(),
				signal,
			}),
		);
		signal.throwIfAborted();
		await assertExportCsvSafe(
			await dependencies.storage.read(csvKey, csv.checksum, csv.bytes),
			secrets,
			rowCount,
		);
		const manifest = await buildExportManifest(dependencies.database, job, {
			...csv,
			rowCount,
		});
		const manifestBytes = Buffer.from(canonicalJson(manifest));
		await dependencies.storage.put(manifestKey, manifestBytes);
		const artifacts = [
			{ kind: "csv", objectKey: csvKey, ...csv, rowCount },
			{
				kind: "manifest",
				objectKey: manifestKey,
				checksum: publicationChecksum(manifestBytes),
				bytes: manifestBytes.byteLength,
				rowCount: null,
			},
		].map((artifact) =>
			exportArtifactSchema.parse({
				id: randomUUID(),
				exportId: job.id,
				workspaceId: job.workspaceId,
				attemptId: attempt.id,
				...artifact,
			}),
		);
		signal.throwIfAborted();
		const ready = await publishExport(
			dependencies.database,
			dependencies.storage,
			claim,
			artifacts,
		);
		return {
			status: ready ? ("ready" as const) : ("lease_lost" as const),
			exportId: job.id,
		};
	} catch (error: unknown) {
		if (lost) return { status: "lease_lost" as const, exportId: job.id };
		const code =
			error instanceof ResearchFailure &&
			["CAPACITY_LIMIT", "INVALID_REQUEST"].includes(error.code)
				? (error.code as "CAPACITY_LIMIT" | "INVALID_REQUEST")
				: "DEPENDENCY_UNAVAILABLE";
		const owned = await failResearchExport(
			dependencies.database,
			claim,
			code,
			dependencies.policy,
		);
		return {
			status: owned ? ("failed" as const) : ("lease_lost" as const),
			exportId: job.id,
		};
	} finally {
		clearInterval(timer);
		clearTimeout(timeout);
		controller.abort();
		await heartbeat;
	}
}
