import { z } from "zod";
import {
	researchExportSchema,
	researchAreaSchema,
	researchAnalysisResultSchema,
	researchPeriodSchema,
	monitoringLocationSchema,
	inspectionAssignmentSchema,
	researchReportSchema,
} from "./research-contracts.ts";
import {
	analysisManifestSchema,
	analysisArtifactSchema,
} from "./research-foundation-contracts.ts";
import { errorPayload } from "./research-store.ts";
import { hasPrivateExportPath } from "./research-export-paths.ts";

export const exportIdSchema = researchExportSchema.shape.id;
export const exportChecksumSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const instant = z.string().datetime({ offset: true });
const storedInstant = z.coerce.date().transform((value) => value.toISOString());
export const exportSanitizationVersion = "csv-safe-2";
export const inspectionContextSchema = z
	.object({
		locations: z.array(monitoringLocationSchema).max(1000),
		assignments: z.array(inspectionAssignmentSchema).max(2000),
		reports: z.array(researchReportSchema).max(2000),
	})
	.strict()
	.superRefine((context, issue) => {
		const locations = new Map(
			context.locations.map((location) => [location.id, location]),
		);
		const assignments = new Map(
			context.assignments.map((assignment) => [assignment.id, assignment]),
		);
		const workspaces = new Set(
			[...context.locations, ...context.assignments, ...context.reports].map(
				(record) => record.workspaceId,
			),
		);
		if (
			workspaces.size > 1 ||
			locations.size !== context.locations.length ||
			assignments.size !== context.assignments.length ||
			new Set(context.reports.map((report) => report.id)).size !==
				context.reports.length ||
			context.assignments.some(
				(assignment) => !locations.has(assignment.locationId),
			) ||
			context.reports.some(
				(report) =>
					!locations.has(report.locationId) ||
					assignments.get(report.assignmentId)?.locationId !==
						report.locationId,
			)
		)
			issue.addIssue({
				code: "custom",
				message: "Inspection snapshot scope is inconsistent",
			});
	});
export const inspectionExportSnapshotSchema = z
	.object({ capturedAt: instant, context: inspectionContextSchema })
	.strict();

function snapshotMatchesWorkspace(
	context: z.infer<typeof inspectionContextSchema>,
	workspaceId: string,
): boolean {
	return [
		...context.locations,
		...context.assignments,
		...context.reports,
	].every((record) => record.workspaceId === workspaceId);
}

export const researchExportManifestSchema = z
	.object({
		schemaVersion: z.literal("research-export-manifest-1"),
		exportId: exportIdSchema,
		analysisId: exportIdSchema,
		analysisManifestId: exportIdSchema,
		kind: researchExportSchema.shape.kind,
		periodRole: researchExportSchema.shape.periodRole,
		snapshotAt: instant,
		area: researchAreaSchema,
		period: researchPeriodSchema,
		summary: researchAnalysisResultSchema.shape.primary,
		granularity: z.enum(["observations", "period-and-months", "period-only"]),
		mode: researchAnalysisResultSchema.shape.mode,
		dataVersion: exportIdSchema,
		unit: z.enum([
			"original-hotspot-detections",
			"estimated-hotspot-detections",
		]),
		method: researchAnalysisResultSchema.shape.method,
		baseline: researchAnalysisResultSchema.shape.baseline,
		sources: researchAnalysisResultSchema.shape.sources,
		provenance: z
			.object({
				producerVersion: analysisManifestSchema.shape.producerVersion,
				buildCommit: analysisManifestSchema.shape.buildCommit,
				satelliteConfigVersion:
					analysisManifestSchema.shape.satelliteConfigVersion,
				aggregationVersion: analysisManifestSchema.shape.aggregationVersion,
				qualityPolicyVersion: analysisManifestSchema.shape.qualityPolicyVersion,
				baselinePolicyVersion:
					analysisManifestSchema.shape.baselinePolicyVersion,
				pairingPolicyVersion: analysisManifestSchema.shape.pairingPolicyVersion,
				missingnessPolicyVersion:
					analysisManifestSchema.shape.missingnessPolicyVersion,
				trainPeriod: analysisManifestSchema.shape.trainPeriod,
				testPeriod: analysisManifestSchema.shape.testPeriod,
				sourceSnapshots: analysisManifestSchema.shape.sourceSnapshots,
			})
			.strict(),
		formatterVersion: exportChecksumSchema,
		sanitizationVersion: z.literal(exportSanitizationVersion),
		inspectionContext: inspectionContextSchema,
		csv: z
			.object({
				checksum: exportChecksumSchema,
				bytes: z
					.number()
					.int()
					.nonnegative()
					.max(64 * 1024 * 1024),
				rowCount: z.number().int().nonnegative().max(1_000_000),
			})
			.strict(),
	})
	.strict()
	.superRefine((manifest, issue) => {
		if (
			hasPrivateExportPath(manifest) ||
			!snapshotMatchesWorkspace(
				manifest.inspectionContext,
				manifest.area.workspaceId,
			) ||
			manifest.method.manifestId !== manifest.analysisManifestId ||
			manifest.period.start !== manifest.summary.period.start ||
			manifest.period.end !== manifest.summary.period.end ||
			manifest.unit !==
				(manifest.kind === "raw-hotspots-csv"
					? "original-hotspot-detections"
					: manifest.method.unit) ||
			(manifest.kind === "raw-hotspots-csv" &&
				manifest.csv.rowCount !== (manifest.summary.metric.rawCount ?? 0))
		)
			issue.addIssue({
				code: "custom",
				message: "Export manifest context is inconsistent",
			});
	});
export type ResearchExportManifest = z.infer<
	typeof researchExportManifestSchema
>;

export const researchExportRecordSchema = z
	.object({
		id: exportIdSchema,
		workspaceId: exportIdSchema,
		analysisId: exportIdSchema,
		requestedById: exportIdSchema,
		exportKey: exportChecksumSchema,
		kind: z.enum(["raw_hotspots_csv", "harmonized_aggregates_csv"]),
		periodRole: researchExportSchema.shape.periodRole,
		analysisChecksum: exportChecksumSchema,
		manifestChecksum: exportChecksumSchema,
		formatterVersion: exportChecksumSchema,
		sanitizationVersion: z.literal(exportSanitizationVersion),
		inspectionSnapshot: inspectionExportSnapshotSchema,
		snapshotChecksum: exportChecksumSchema,
		status: researchExportSchema.shape.status,
		createdAt: storedInstant,
		startedAt: storedInstant.nullable(),
		completedAt: storedInstant.nullable(),
		resultAttemptId: exportIdSchema.nullable(),
		error: researchExportSchema.shape.error,
	})
	.superRefine((row, issue) => {
		if (
			!snapshotMatchesWorkspace(row.inspectionSnapshot.context, row.workspaceId)
		)
			issue.addIssue({
				code: "custom",
				message: "Export snapshot workspace mismatch",
			});
	});
export type ResearchExportRecord = z.infer<typeof researchExportRecordSchema>;
export const researchExportAttemptSchema = z.object({
	id: exportIdSchema,
	exportId: exportIdSchema,
	workspaceId: exportIdSchema,
	attemptNo: z.number().int().positive(),
	leaseToken: z.string().uuid().toLowerCase(),
	status: z.enum(["running", "succeeded", "failed", "expired"]),
	claimedAt: storedInstant,
	heartbeatAt: storedInstant,
	leaseExpiresAt: storedInstant,
	completedAt: storedInstant.nullable(),
	errorCode: z.string().nullable(),
	retryable: z.boolean().nullable(),
});
export type ResearchExportAttempt = z.infer<typeof researchExportAttemptSchema>;
export interface ResearchExportClaim {
	job: ResearchExportRecord;
	attempt: ResearchExportAttempt;
}
export const exportArtifactSchema = z.object({
	id: exportIdSchema,
	exportId: exportIdSchema,
	workspaceId: exportIdSchema,
	attemptId: exportIdSchema,
	kind: z.enum(["csv", "manifest"]),
	objectKey: analysisArtifactSchema.shape.objectKey,
	checksum: exportChecksumSchema,
	bytes: z.coerce
		.number()
		.int()
		.nonnegative()
		.max(64 * 1024 * 1024),
	rowCount: z.number().int().nonnegative().nullable(),
});
export type ResearchExportArtifact = z.infer<typeof exportArtifactSchema>;
export function exportWire(row: ResearchExportRecord) {
	return researchExportSchema.parse({
		schemaVersion: "research-2",
		id: row.id,
		workspaceId: row.workspaceId,
		analysisId: row.analysisId,
		kind:
			row.kind === "raw_hotspots_csv"
				? "raw-hotspots-csv"
				: "harmonized-aggregates-csv",
		periodRole: row.periodRole,
		status: row.status,
		downloadPath:
			row.status === "ready"
				? `/api/v2/workspaces/${encodeURIComponent(row.workspaceId)}/exports/${encodeURIComponent(row.id)}/download`
				: null,
		error:
			row.status === "failed"
				? errorPayload(row.error?.code ?? "DEPENDENCY_UNAVAILABLE")
				: null,
	});
}
