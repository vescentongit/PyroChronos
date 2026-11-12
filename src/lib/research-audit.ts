import { randomUUID } from "node:crypto";
import type { LocationDatabase } from "./monitoring-locations.ts";
import {
	inspectionAuditSchema,
	type InspectionAudit,
} from "./research-inspection-contracts.ts";
import { assertInspectionSafe } from "./research-inspection-store.ts";

export async function appendInspectionAudit(
	tx: LocationDatabase,
	input: InspectionAudit,
): Promise<void> {
	const event = inspectionAuditSchema.parse(input);
	assertInspectionSafe(event);
	await tx.query(
		`INSERT INTO "InspectionAuditEvent"
		(id,"workspaceId","locationId","assignmentId","reportId",action,"requestId","actorId",actor,"occurredAt","fromRevision","toRevision","fromStatus","toStatus")
		VALUES ($1,$2,$3,$4,$5,$6::"P1InspectionAuditAction",$7::uuid,$8,$9::jsonb,$10::timestamptz,$11,$12,$13::"P1InspectionAssignmentStatus",$14::"P1InspectionAssignmentStatus")`,
		[
			randomUUID(),
			event.workspaceId,
			event.locationId,
			event.assignmentId,
			event.reportId,
			event.action,
			event.requestId,
			event.actor.id,
			JSON.stringify(event.actor),
			event.occurredAt,
			event.fromRevision,
			event.toRevision,
			event.fromStatus,
			event.toStatus,
		],
	);
}
