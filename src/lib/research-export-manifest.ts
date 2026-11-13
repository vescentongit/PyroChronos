import type { LocationDatabase } from "./monitoring-locations.ts";
import { monitoringLocationSchema } from "./research-contracts.ts";
import { analysisManifestSchema } from "./research-foundation-contracts.ts";
import {
	assignmentRecordSchema,
	assignmentWire,
	reportRecordSchema,
	inspectionInstantSchema,
} from "./research-inspection-contracts.ts";
import { projectResearchReport } from "./research-report-projection.ts";
import { readPublishedAnalysis } from "./research-observations.ts";
import {
	assertPublicationMetadataSafe,
	canonicalJson,
	publicationChecksum,
	publicationSecrets,
} from "./research-publication-values.ts";
import { fail } from "./research-store.ts";
import { hasPrivateExportPath } from "./research-export-paths.ts";
import {
	inspectionExportSnapshotSchema,
	researchExportManifestSchema,
	type ResearchExportRecord,
} from "./research-export-contracts.ts";

export async function readExportSource(
	db: LocationDatabase,
	workspaceId: string,
	analysisId: string,
) {
	const result = await readPublishedAnalysis(db, workspaceId, analysisId);
	const [row] = await db.query(
		'SELECT m.* FROM "AnalysisManifest" m JOIN "AnalysisResult" r ON r."manifestId"=m.id AND r."jobId"=m."jobId" AND r."workspaceId"=m."workspaceId" WHERE r.id=$1 AND r."workspaceId"=$2',
		[analysisId, workspaceId],
	);
	if (!row) return fail("DEPENDENCY_UNAVAILABLE", 503);
	const manifest = analysisManifestSchema.parse(row.content);
	if (
		publicationChecksum(canonicalJson(manifest)) !== row.checksum ||
		manifest.id !== result.method.manifestId ||
		manifest.dataVersion !== result.dataVersion
	)
		return fail("DEPENDENCY_UNAVAILABLE", 503);
	return {
		result,
		manifest,
		analysisChecksum: publicationChecksum(canonicalJson(result)),
		manifestChecksum: row.checksum as string,
	};
}

export async function captureExportInspections(
	db: LocationDatabase,
	workspaceId: string,
	analysisId: string,
) {
	const [clock] = await db.query("SELECT clock_timestamp() AS now");
	const rows = await db.query(
		`SELECT l.* FROM "MonitoringLocation" l WHERE l."workspaceId"=$1 AND
		(l."initialAnalysisId"=$2 OR EXISTS(SELECT 1 FROM "MonitoringLocationAnalysis" x WHERE x."locationId"=l.id AND x."workspaceId"=l."workspaceId" AND x."analysisId"=$2)) ORDER BY l.id LIMIT 1001`,
		[workspaceId, analysisId],
	);
	if (rows.length > 1000) return fail("CAPACITY_LIMIT", 503);
	const locations = rows.map((row) =>
		monitoringLocationSchema.parse({
			schemaVersion: "research-2",
			id: row.id,
			workspaceId: row.workspaceId,
			name: row.name,
			anchor: row.anchor,
			initialAnalysisId: row.initialAnalysisId,
			areaId: row.areaId,
			areaRevision: row.areaRevision,
			createdBy: row.createdBy,
			createdAt: inspectionInstantSchema.parse(row.createdAt),
		}),
	);
	const assignmentRows = await db.query(
		`SELECT a.* FROM "InspectionAssignment" a WHERE a."workspaceId"=$1 AND a."locationId" IN
		(SELECT l.id FROM "MonitoringLocation" l WHERE l."workspaceId"=$1 AND (l."initialAnalysisId"=$2 OR EXISTS(SELECT 1 FROM "MonitoringLocationAnalysis" x WHERE x."locationId"=l.id AND x."workspaceId"=$1 AND x."analysisId"=$2))) ORDER BY a.id LIMIT 2001`,
		[workspaceId, analysisId],
	);
	if (assignmentRows.length > 2000) return fail("CAPACITY_LIMIT", 503);
	const assignments = assignmentRows.map((row) =>
		assignmentWire(assignmentRecordSchema.parse(row)),
	);
	const reportRows = await db.query(
		`SELECT r.* FROM "P1InspectionReport" r WHERE r."workspaceId"=$1 AND r."locationId" IN
		(SELECT l.id FROM "MonitoringLocation" l WHERE l."workspaceId"=$1 AND (l."initialAnalysisId"=$2 OR EXISTS(SELECT 1 FROM "MonitoringLocationAnalysis" x WHERE x."locationId"=l.id AND x."workspaceId"=$1 AND x."analysisId"=$2))) ORDER BY r.id LIMIT 2001`,
		[workspaceId, analysisId],
	);
	if (reportRows.length > 2000) return fail("CAPACITY_LIMIT", 503);
	const reports = [];
	for (const row of reportRows)
		reports.push(
			await projectResearchReport(db, reportRecordSchema.parse(row)),
		);
	return inspectionExportSnapshotSchema.parse({
		capturedAt: inspectionInstantSchema.parse(clock?.now),
		context: { locations, assignments, reports },
	});
}

export async function exportSecretValues(
	db: LocationDatabase,
	row: ResearchExportRecord,
): Promise<readonly string[]> {
	const tokens = await db.query(
		`SELECT a."leaseToken"::text AS token FROM "P1AnalysisJobAttempt" a JOIN "AnalysisResult" r ON r."jobId"=a."jobId" AND r."workspaceId"=a."workspaceId" WHERE r.id=$1 AND r."workspaceId"=$2
		UNION ALL SELECT "leaseToken"::text AS token FROM "ResearchExportAttempt" WHERE "exportId"=$3 AND "workspaceId"=$2`,
		[row.analysisId, row.workspaceId, row.id],
	);
	return publicationSecrets(tokens.map((token) => String(token.token)));
}
export async function assertExportSafe(
	db: LocationDatabase,
	row: ResearchExportRecord,
	value: unknown,
): Promise<void> {
	try {
		assertPublicationMetadataSafe(value, await exportSecretValues(db, row));
		if (hasPrivateExportPath(value)) return fail("DEPENDENCY_UNAVAILABLE", 503);
	} catch {
		return fail("DEPENDENCY_UNAVAILABLE", 503);
	}
}
export function exportSnapshotChecksum(row: ResearchExportRecord): string {
	return publicationChecksum(canonicalJson(row.inspectionSnapshot.context));
}

export async function buildExportManifest(
	db: LocationDatabase,
	row: ResearchExportRecord,
	csv: { checksum: string; bytes: number; rowCount: number },
) {
	const source = await readExportSource(db, row.workspaceId, row.analysisId);
	if (
		source.analysisChecksum !== row.analysisChecksum ||
		source.manifestChecksum !== row.manifestChecksum ||
		exportSnapshotChecksum(row) !== row.snapshotChecksum
	)
		return fail("DEPENDENCY_UNAVAILABLE", 503);
	const { result, manifest } = source;
	const period =
		row.periodRole === "primary"
			? result.primary.period
			: result.comparison?.period;
	if (!period) return fail("INVALID_REQUEST");
	const provenance = researchExportManifestSchema.shape.provenance.parse(
		Object.fromEntries(
			Object.entries(manifest).filter(([key]) =>
				Object.hasOwn(researchExportManifestSchema.shape.provenance.shape, key),
			),
		),
	);
	const payload = researchExportManifestSchema.parse({
		schemaVersion: "research-export-manifest-1",
		exportId: row.id,
		analysisId: row.analysisId,
		analysisManifestId: manifest.id,
		kind:
			row.kind === "raw_hotspots_csv"
				? "raw-hotspots-csv"
				: "harmonized-aggregates-csv",
		periodRole: row.periodRole,
		snapshotAt: row.inspectionSnapshot.capturedAt,
		area: result.area,
		period,
		summary: row.periodRole === "primary" ? result.primary : result.comparison,
		granularity:
			row.kind === "raw_hotspots_csv"
				? "observations"
				: row.periodRole === "primary"
					? "period-and-months"
					: "period-only",
		mode: result.mode,
		dataVersion: result.dataVersion,
		unit:
			row.kind === "raw_hotspots_csv"
				? "original-hotspot-detections"
				: result.method.unit,
		method: result.method,
		baseline: result.baseline,
		sources: result.sources,
		provenance,
		formatterVersion: row.formatterVersion,
		sanitizationVersion: row.sanitizationVersion,
		inspectionContext: row.inspectionSnapshot.context,
		csv,
	});
	await assertExportSafe(db, row, payload);
	return payload;
}
