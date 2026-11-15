import { z } from "zod";
import {
	inspectionAssignmentSchema,
	researchReportSchema,
} from "./research-contracts.ts";

export const inspectionIdSchema = inspectionAssignmentSchema.shape.id;
export const inspectionActorSchema = inspectionAssignmentSchema.shape.assignee;
export const inspectionInstantSchema = z.coerce
	.date()
	.transform((date) => date.toISOString());
export type InspectionActor = z.infer<typeof inspectionActorSchema>;
export type InspectionAssignment = z.infer<typeof inspectionAssignmentSchema>;
export type ResearchReport = z.infer<typeof researchReportSchema>;
export type AssignmentStatus = InspectionAssignment["status"];

export function canTransitionAssignment(
	from: AssignmentStatus,
	to: AssignmentStatus,
	hasReport: boolean,
): boolean {
	return (
		(from === "assigned"
			? ["in_progress", "completed", "cancelled"].includes(to)
			: from === "in_progress" && ["completed", "cancelled"].includes(to)) &&
		(to !== "completed" || hasReport)
	);
}

export const assignmentRecordSchema = inspectionAssignmentSchema
	.omit({ schemaVersion: true, createdAt: true, updatedAt: true })
	.extend({
		requestId: z.string().uuid(),
		assigneeUserId: inspectionIdSchema,
		assignedById: inspectionIdSchema,
		createdAt: inspectionInstantSchema,
		updatedAt: inspectionInstantSchema,
	})
	.strip();
export type AssignmentRecord = z.infer<typeof assignmentRecordSchema>;
export const reportRecordSchema = researchReportSchema
	.omit({
		schemaVersion: true,
		revision: true,
		updatedAt: true,
		corrections: true,
		createdAt: true,
	})
	.extend({
		requestId: z.string().uuid(),
		recordedById: inspectionIdSchema,
		inspector: inspectionActorSchema,
		observedAt: inspectionInstantSchema,
		createdAt: inspectionInstantSchema,
	})
	.strip();
export type ReportRecord = z.infer<typeof reportRecordSchema>;
export const reportRevisionRecordSchema = z.object({
	id: inspectionIdSchema,
	workspaceId: inspectionIdSchema,
	reportId: inspectionIdSchema,
	revision: z.number().int().min(2),
	requestId: z.string().uuid(),
	reason: z.string().trim().min(1).max(500),
	inspectorUserId: inspectionIdSchema,
	inspector: inspectionActorSchema,
	observedAt: inspectionInstantSchema,
	outcome: researchReportSchema.shape.outcome,
	notes: researchReportSchema.shape.notes,
	correctedById: inspectionIdSchema,
	correctedBy: inspectionActorSchema,
	correctedAt: inspectionInstantSchema,
});

export function assignmentWire(record: AssignmentRecord): InspectionAssignment {
	const {
		requestId: _requestId,
		assigneeUserId: _assigneeUserId,
		assignedById: _assignedById,
		...dto
	} = record;
	return inspectionAssignmentSchema.parse({
		schemaVersion: "research-2",
		...dto,
	});
}

export const inspectionAuditSchema = z
	.object({
		workspaceId: inspectionIdSchema,
		locationId: inspectionIdSchema,
		assignmentId: inspectionIdSchema,
		reportId: inspectionIdSchema.nullable(),
		action: z.enum([
			"assignment_created",
			"assignment_status_changed",
			"report_created",
			"report_corrected",
		]),
		requestId: z.string().uuid(),
		actor: inspectionActorSchema,
		occurredAt: z.string().datetime({ offset: true }),
		fromRevision: z.number().int().positive().nullable(),
		toRevision: z.number().int().positive(),
		fromStatus: inspectionAssignmentSchema.shape.status.nullable(),
		toStatus: inspectionAssignmentSchema.shape.status.nullable(),
	})
	.strict();
export type InspectionAudit = z.infer<typeof inspectionAuditSchema>;
