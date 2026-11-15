import { randomUUID } from "node:crypto";
import type { LocationDatabase } from "./monitoring-locations.ts";
import {
	createInspectionAssignmentSchema,
	inspectionAssignmentSchema,
	updateInspectionAssignmentSchema,
} from "./research-contracts.ts";
import { fail, idempotent, member } from "./research-store.ts";
import { appendInspectionAudit } from "./research-audit.ts";
import {
	assignmentRecordSchema,
	assignmentWire,
	canTransitionAssignment,
} from "./research-inspection-contracts.ts";
import {
	inspectionActor,
	inspectionNextCursor,
	inspectionPage,
	inspectionWrite,
	parseInspectionRequest,
	readInspectionAssignment,
	requireInspectionLocation,
} from "./research-inspection-store.ts";

export async function createInspectionAssignment(
	db: LocationDatabase,
	workspaceId: string,
	userId: string,
	locationId: string,
	body: unknown,
) {
	const input = parseInspectionRequest(createInspectionAssignmentSchema, body);
	return inspectionWrite(db, workspaceId, userId, async (tx, caller) => {
		await requireInspectionLocation(tx, workspaceId, locationId);
		const receipt = await idempotent(
			tx,
			`assignment-create:${workspaceId}:${userId}:${locationId}`,
			input.requestId,
			input,
			async () => {
				const assignee = await inspectionActor(
					tx,
					workspaceId,
					input.assigneeUserId,
				);
				const [row] = await tx.query(
					`WITH stamp AS (SELECT clock_timestamp()::timestamptz(3) AS at)
				INSERT INTO "InspectionAssignment" (id,"workspaceId","locationId","requestId","assigneeUserId",assignee,"assignedById","assignedBy","createdAt","updatedAt")
				SELECT $1,$2,$3,$4::uuid,$5,$6::jsonb,$7,$8::jsonb,stamp.at,stamp.at FROM stamp RETURNING *`,
					[
						randomUUID(),
						workspaceId,
						locationId,
						input.requestId,
						assignee.actor.id,
						JSON.stringify(assignee.actor),
						userId,
						JSON.stringify(caller.actor),
					],
				);
				const assignment = assignmentWire(assignmentRecordSchema.parse(row));
				await appendInspectionAudit(tx, {
					workspaceId,
					locationId,
					assignmentId: assignment.id,
					reportId: null,
					action: "assignment_created",
					requestId: input.requestId,
					actor: caller.actor,
					occurredAt: assignment.createdAt,
					fromRevision: null,
					toRevision: 1,
					fromStatus: null,
					toStatus: "assigned",
				});
				return { value: assignment, status: 201 };
			},
		);
		return inspectionAssignmentSchema.parse(receipt.value);
	});
}

export async function updateInspectionAssignment(
	db: LocationDatabase,
	workspaceId: string,
	userId: string,
	assignmentId: string,
	body: unknown,
) {
	const input = parseInspectionRequest(updateInspectionAssignmentSchema, body);
	return inspectionWrite(db, workspaceId, userId, async (tx, caller) => {
		const current = await readInspectionAssignment(
			tx,
			workspaceId,
			assignmentId,
			true,
		);
		if (
			caller.role !== "owner" &&
			userId !== current.assigneeUserId &&
			userId !== current.assignedById
		)
			return fail("FORBIDDEN", 403);
		const receipt = await idempotent(
			tx,
			`assignment-update:${workspaceId}:${userId}:${assignmentId}`,
			input.requestId,
			input,
			async () => {
				if (input.expectedRevision !== current.revision)
					return fail("REVISION_CONFLICT", 409);
				const [report] = await tx.query(
					'SELECT id FROM "P1InspectionReport" WHERE "assignmentId"=$1 AND "workspaceId"=$2 LIMIT 1',
					[assignmentId, workspaceId],
				);
				if (
					!canTransitionAssignment(
						current.status,
						input.status,
						Boolean(report),
					)
				)
					return fail("INVALID_REQUEST");
				const [row] = await tx.query(
					'UPDATE "InspectionAssignment" SET status=$1::"P1InspectionAssignmentStatus",revision=revision+1,"updatedAt"=clock_timestamp() WHERE id=$2 AND "workspaceId"=$3 AND revision=$4 RETURNING *',
					[input.status, assignmentId, workspaceId, input.expectedRevision],
				);
				if (!row) return fail("REVISION_CONFLICT", 409);
				const assignment = assignmentWire(assignmentRecordSchema.parse(row));
				await appendInspectionAudit(tx, {
					workspaceId,
					locationId: current.locationId,
					assignmentId,
					reportId: null,
					action: "assignment_status_changed",
					requestId: input.requestId,
					actor: caller.actor,
					occurredAt: assignment.updatedAt,
					fromRevision: current.revision,
					toRevision: assignment.revision,
					fromStatus: current.status,
					toStatus: assignment.status,
				});
				return { value: assignment, status: 200 };
			},
		);
		return inspectionAssignmentSchema.parse(receipt.value);
	});
}

export async function listInspectionAssignments(
	db: LocationDatabase,
	workspaceId: string,
	userId: string,
	locationId: string,
	query: unknown = {},
) {
	await member(db, workspaceId, userId);
	await requireInspectionLocation(db, workspaceId, locationId);
	const scope = `assignments:${workspaceId}:${locationId}`;
	const { limit, position } = inspectionPage(query, scope);
	const rows = await db.query(
		`SELECT * FROM "InspectionAssignment" WHERE "workspaceId"=$1 AND "locationId"=$2
		AND ($3::timestamptz IS NULL OR ("createdAt",id)>($3::timestamptz,$4::text)) ORDER BY "createdAt",id LIMIT $5`,
		[
			workspaceId,
			locationId,
			position?.createdAt ?? null,
			position?.id ?? null,
			limit + 1,
		],
	);
	const items = rows
		.slice(0, limit)
		.map((row) => assignmentWire(assignmentRecordSchema.parse(row)));
	return {
		items,
		nextCursor: inspectionNextCursor(items, rows.length > limit, scope),
	};
}
