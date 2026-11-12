import { randomUUID } from "node:crypto";
import type { LocationDatabase } from "./monitoring-locations.ts";
import {
	correctResearchReportSchema,
	createResearchReportSchema,
	researchReportSchema,
} from "./research-contracts.ts";
import { fail, idempotent, member } from "./research-store.ts";
import { appendInspectionAudit } from "./research-audit.ts";
import {
	reportRecordSchema,
	reportRevisionRecordSchema,
	type ReportRecord,
	type ResearchReport,
} from "./research-inspection-contracts.ts";
import {
	inspectionActor,
	inspectionNextCursor,
	inspectionPage,
	inspectionWrite,
	parseInspectionRequest,
	readInspectionAssignment,
	readInspectionReport,
	requireInspectionLocation,
	validateInspectionTime,
} from "./research-inspection-store.ts";

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

async function reportWire(
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

export async function createResearchReport(
	db: LocationDatabase,
	workspaceId: string,
	userId: string,
	assignmentId: string,
	body: unknown,
) {
	const input = parseInspectionRequest(createResearchReportSchema, body);
	return inspectionWrite(db, workspaceId, userId, async (tx, caller) => {
		const assignment = await readInspectionAssignment(
			tx,
			workspaceId,
			assignmentId,
			true,
		);
		const receipt = await idempotent(
			tx,
			`report-create:${workspaceId}:${userId}:${assignmentId}`,
			input.requestId,
			input,
			async () => {
				if (!["assigned", "in_progress"].includes(assignment.status))
					return fail("INVALID_REQUEST");
				await validateInspectionTime(tx, input.observedAt);
				const inspector = await inspectionActor(
					tx,
					workspaceId,
					input.inspectorUserId,
				);
				const [row] = await tx.query(
					`INSERT INTO "P1InspectionReport" (id,"workspaceId","locationId","assignmentId","requestId","inspectorUserId",inspector,"observedAt",outcome,notes,"recordedById","recordedBy","createdAt")
				VALUES ($1,$2,$3,$4,$5::uuid,$6,$7::jsonb,$8::timestamptz,$9::"P1InspectionOutcome",$10,$11,$12::jsonb,clock_timestamp()) RETURNING *`,
					[
						randomUUID(),
						workspaceId,
						assignment.locationId,
						assignmentId,
						input.requestId,
						inspector.actor.id,
						JSON.stringify(inspector.actor),
						input.observedAt,
						input.outcome,
						input.notes,
						userId,
						JSON.stringify(caller.actor),
					],
				);
				const root = reportRecordSchema.parse(row);
				await appendInspectionAudit(tx, {
					workspaceId,
					locationId: root.locationId,
					assignmentId,
					reportId: root.id,
					action: "report_created",
					requestId: input.requestId,
					actor: caller.actor,
					occurredAt: root.createdAt,
					fromRevision: null,
					toRevision: 1,
					fromStatus: null,
					toStatus: null,
				});
				return { value: await reportWire(tx, root), status: 201 };
			},
		);
		return researchReportSchema.parse(receipt.value);
	});
}

export async function correctResearchReport(
	db: LocationDatabase,
	workspaceId: string,
	userId: string,
	reportId: string,
	body: unknown,
) {
	const input = parseInspectionRequest(correctResearchReportSchema, body);
	return inspectionWrite(db, workspaceId, userId, async (tx, caller) => {
		const reference = await readInspectionReport(tx, workspaceId, reportId);
		await readInspectionAssignment(
			tx,
			workspaceId,
			reference.assignmentId,
			true,
		);
		const root = await readInspectionReport(tx, workspaceId, reportId, true);
		if (caller.role !== "owner" && root.recordedById !== userId)
			return fail("FORBIDDEN", 403);
		const receipt = await idempotent(
			tx,
			`report-correct:${workspaceId}:${userId}:${reportId}`,
			input.requestId,
			input,
			async () => {
				const current = await reportWire(tx, root);
				if (input.expectedRevision !== current.revision)
					return fail("REVISION_CONFLICT", 409);
				await validateInspectionTime(tx, input.observedAt);
				const inspector = await inspectionActor(
					tx,
					workspaceId,
					input.inspectorUserId,
				);
				const [row] = await tx.query(
					`INSERT INTO "P1InspectionReportRevision" (id,"workspaceId","reportId",revision,"requestId",reason,"inspectorUserId",inspector,"observedAt",outcome,notes,"correctedById","correctedBy","correctedAt")
				VALUES ($1,$2,$3,$4,$5::uuid,$6,$7,$8::jsonb,$9::timestamptz,$10::"P1InspectionOutcome",$11,$12,$13::jsonb,clock_timestamp()) RETURNING *`,
					[
						randomUUID(),
						workspaceId,
						reportId,
						current.revision + 1,
						input.requestId,
						input.reason,
						inspector.actor.id,
						JSON.stringify(inspector.actor),
						input.observedAt,
						input.outcome,
						input.notes,
						userId,
						JSON.stringify(caller.actor),
					],
				);
				const revision = reportRevisionRecordSchema.parse(row);
				await appendInspectionAudit(tx, {
					workspaceId,
					locationId: root.locationId,
					assignmentId: root.assignmentId,
					reportId,
					action: "report_corrected",
					requestId: input.requestId,
					actor: caller.actor,
					occurredAt: revision.correctedAt,
					fromRevision: current.revision,
					toRevision: revision.revision,
					fromStatus: null,
					toStatus: null,
				});
				return { value: await reportWire(tx, root), status: 200 };
			},
		);
		return researchReportSchema.parse(receipt.value);
	});
}

export async function listResearchReports(
	db: LocationDatabase,
	workspaceId: string,
	userId: string,
	locationId: string,
	query: unknown = {},
) {
	await member(db, workspaceId, userId);
	await requireInspectionLocation(db, workspaceId, locationId);
	const scope = `reports:${workspaceId}:${locationId}`;
	const { limit, position } = inspectionPage(query, scope);
	const rows = await db.query(
		`SELECT * FROM "P1InspectionReport" WHERE "workspaceId"=$1 AND "locationId"=$2
		AND ($3::timestamptz IS NULL OR ("createdAt",id)>($3::timestamptz,$4::text)) ORDER BY "createdAt",id LIMIT $5`,
		[
			workspaceId,
			locationId,
			position?.createdAt ?? null,
			position?.id ?? null,
			limit + 1,
		],
	);
	const items: ResearchReport[] = [];
	for (const row of rows.slice(0, limit))
		items.push(await reportWire(db, reportRecordSchema.parse(row)));
	return {
		items,
		nextCursor: inspectionNextCursor(items, rows.length > limit, scope),
	};
}
