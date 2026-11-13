import type { LocationDatabase } from "./monitoring-locations.ts";
import { researchReportSchema } from "./research-contracts.ts";
import { fail } from "./research-store.ts";
import {
	reportRevisionRecordSchema,
	type ReportRecord,
	type ResearchReport,
} from "./research-inspection-contracts.ts";

const reportFields = (
	value: Pick<
		ResearchReport,
		"inspectorUserId" | "observedAt" | "outcome" | "notes"
	>,
) => ({
	inspectorUserId: value.inspectorUserId,
	observedAt: value.observedAt,
	outcome: value.outcome,
	notes: value.notes,
});

export async function projectResearchReport(
	db: LocationDatabase,
	root: ReportRecord,
): Promise<ResearchReport> {
	const rows = await db.query(
		'SELECT * FROM "P1InspectionReportRevision" WHERE "reportId"=$1 AND "workspaceId"=$2 ORDER BY revision',
		[root.id, root.workspaceId],
	);
	const revisions = rows.map((row) => reportRevisionRecordSchema.parse(row));
	if (revisions.some((row, index) => row.revision !== index + 2))
		return fail("INTERNAL_ERROR", 500);
	const states = [reportFields(root), ...revisions.map(reportFields)];
	const latest = revisions.at(-1);
	return researchReportSchema.parse({
		schemaVersion: "research-2",
		id: root.id,
		workspaceId: root.workspaceId,
		locationId: root.locationId,
		assignmentId: root.assignmentId,
		...states[states.length - 1],
		recordedBy: root.recordedBy,
		revision: latest?.revision ?? 1,
		createdAt: root.createdAt,
		updatedAt: latest?.correctedAt ?? root.createdAt,
		corrections: revisions.map((revision, index) => ({
			...states[index],
			revision: revision.revision - 1,
			requestId: revision.requestId,
			reason: revision.reason,
			correctedAt: revision.correctedAt,
			correctedBy: revision.correctedBy,
		})),
	});
}
