import { randomUUID } from "node:crypto";
import type { LocationDatabase } from "./monitoring-locations.ts";
import {
	createResearchExportSchema,
	researchExportSchema,
} from "./research-contracts.ts";
import { fail, idempotent, member, workspaceLock } from "./research-store.ts";
import {
	canonicalJson,
	publicationChecksum,
} from "./research-publication-values.ts";
import { parseInspectionRequest } from "./research-inspection-store.ts";
import {
	readExportSource,
	captureExportInspections,
	assertExportSafe,
	buildExportManifest,
	exportSecretValues,
} from "./research-export-manifest.ts";
import {
	exportWire,
	researchExportRecordSchema,
	exportIdSchema,
	exportArtifactSchema,
	researchExportManifestSchema,
	exportSanitizationVersion,
	type ResearchExportRecord,
	type ResearchExportManifest,
} from "./research-export-contracts.ts";
import { researchExportFormatterVersion } from "./research-export-format.ts";
import {
	readVerifiedExportObject,
	type ResearchExportStorage,
} from "./research-export-storage.ts";
import { assertExportCsvSafe } from "./research-export-security.ts";

export interface ResearchExportDependencies {
	database: LocationDatabase;
	storage: ResearchExportStorage;
}
export async function readExportRecord(
	db: LocationDatabase,
	workspaceId: string,
	id: string,
): Promise<ResearchExportRecord> {
	if (!exportIdSchema.safeParse(id).success) return fail("INVALID_REQUEST");
	const [row] = await db.query(
		'SELECT * FROM "ResearchExport" WHERE id=$1 AND "workspaceId"=$2',
		[id, workspaceId],
	);
	return row ? researchExportRecordSchema.parse(row) : fail("NOT_FOUND", 404);
}
export async function createResearchExport(
	dependencies: ResearchExportDependencies,
	workspaceId: string,
	userId: string,
	body: unknown,
) {
	const input = parseInspectionRequest(createResearchExportSchema, body);
	const formatterVersion = await researchExportFormatterVersion();
	return dependencies.database.transaction(async (tx) => {
		await workspaceLock(tx, workspaceId);
		await member(tx, workspaceId, userId);
		const receipt = await idempotent(
			tx,
			`export-create:${workspaceId}:${userId}`,
			input.requestId,
			input,
			async () => {
				const source = await readExportSource(
					tx,
					workspaceId,
					input.analysisId,
				);
				if (input.periodRole === "comparison" && !source.result.comparison)
					return fail("INVALID_REQUEST");
				const inspectionSnapshot = await captureExportInspections(
					tx,
					workspaceId,
					input.analysisId,
				);
				const snapshotChecksum = publicationChecksum(
					canonicalJson(inspectionSnapshot.context),
				);
				const exportKey = publicationChecksum(
					canonicalJson({
						workspaceId,
						analysisId: input.analysisId,
						kind: input.kind,
						periodRole: input.periodRole,
						formatterVersion,
						sanitizationVersion: exportSanitizationVersion,
						analysisChecksum: source.analysisChecksum,
						manifestChecksum: source.manifestChecksum,
						snapshotChecksum,
					}),
				);
				const [existing] = await tx.query(
					'SELECT * FROM "ResearchExport" WHERE "workspaceId"=$1 AND "exportKey"=$2 AND status<>\'failed\'',
					[workspaceId, exportKey],
				);
				if (existing) {
					const row = researchExportRecordSchema.parse(existing);
					return {
						value: exportWire(row),
						status: row.status === "ready" ? 200 : 202,
					};
				}
				const [created] = await tx.query(
					`INSERT INTO "ResearchExport" (id,"workspaceId","analysisId","requestedById","exportKey","periodRole",kind,"analysisChecksum","manifestChecksum","formatterVersion","sanitizationVersion","inspectionSnapshot","snapshotChecksum","createdAt")
				VALUES ($1,$2,$3,$4,$5,$6,$7::"P1ResearchExportKind",$8,$9,$10,$11,$12::jsonb,$13,clock_timestamp()) RETURNING *`,
					[
						randomUUID(),
						workspaceId,
						input.analysisId,
						userId,
						exportKey,
						input.periodRole,
						input.kind === "raw-hotspots-csv"
							? "raw_hotspots_csv"
							: "harmonized_aggregates_csv",
						source.analysisChecksum,
						source.manifestChecksum,
						formatterVersion,
						exportSanitizationVersion,
						canonicalJson(inspectionSnapshot),
						snapshotChecksum,
					],
				);
				const row = researchExportRecordSchema.parse(created);
				await assertExportSafe(tx, row, {
					source: source.manifest,
					snapshot: inspectionSnapshot,
				});
				return { value: exportWire(row), status: 202 };
			},
		);
		return {
			value: researchExportSchema.parse(receipt.value),
			status: receipt.status,
		};
	});
}
export async function readResearchExport(
	dependencies: ResearchExportDependencies,
	workspaceId: string,
	userId: string,
	id: string,
) {
	await member(dependencies.database, workspaceId, userId);
	return exportWire(
		await readExportRecord(dependencies.database, workspaceId, id),
	);
}
async function readReadyPair(
	dependencies: ResearchExportDependencies,
	workspaceId: string,
	userId: string,
	id: string,
) {
	const db = dependencies.database;
	await member(db, workspaceId, userId);
	const row = await readExportRecord(db, workspaceId, id);
	if (row.status !== "ready") return fail("RESULT_NOT_READY", 409);
	const artifacts = (
		await db.query(
			'SELECT * FROM "ResearchExportArtifact" WHERE "exportId"=$1 AND "workspaceId"=$2 AND "attemptId"=$3 ORDER BY kind',
			[id, workspaceId, row.resultAttemptId],
		)
	).map((item) => exportArtifactSchema.parse(item));
	const csv = artifacts.find((item) => item.kind === "csv"),
		manifestFile = artifacts.find((item) => item.kind === "manifest");
	if (artifacts.length !== 2 || !csv || !manifestFile || csv.rowCount === null)
		return fail("DEPENDENCY_UNAVAILABLE", 503);
	const bytes = await readVerifiedExportObject(dependencies.storage, csv);
	const manifestBytes = await readVerifiedExportObject(
		dependencies.storage,
		manifestFile,
	);
	let manifest: ResearchExportManifest;
	try {
		manifest = researchExportManifestSchema.parse(
			JSON.parse(Buffer.from(manifestBytes).toString("utf8")),
		);
	} catch {
		return fail("DEPENDENCY_UNAVAILABLE", 503);
	}
	const expected = await buildExportManifest(db, row, {
		checksum: csv.checksum,
		bytes: csv.bytes,
		rowCount: csv.rowCount,
	});
	if (canonicalJson(manifest) !== canonicalJson(expected))
		return fail("DEPENDENCY_UNAVAILABLE", 503);
	await assertExportSafe(db, row, manifest);
	await assertExportCsvSafe(
		bytes,
		await exportSecretValues(db, row),
		csv.rowCount,
	);
	await member(db, workspaceId, userId);
	return { row, bytes, manifest };
}
export async function getResearchExportManifest(
	dependencies: ResearchExportDependencies,
	workspaceId: string,
	userId: string,
	id: string,
) {
	return (await readReadyPair(dependencies, workspaceId, userId, id)).manifest;
}
export async function getResearchExportDownload(
	dependencies: ResearchExportDependencies,
	workspaceId: string,
	userId: string,
	id: string,
) {
	const { row, bytes } = await readReadyPair(
		dependencies,
		workspaceId,
		userId,
		id,
	);
	return {
		filename: `${row.kind}-${publicationChecksum(row.id).slice(7, 23)}-${row.periodRole}.csv`,
		content: (async function* () {
			for (let offset = 0; offset < bytes.byteLength; offset += 65536)
				yield bytes.slice(offset, offset + 65536);
		})(),
	};
}
