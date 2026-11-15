import { z } from "zod";
import type { LocationDatabase } from "./monitoring-locations.ts";
import {
	cursorRead,
	cursorWrite,
	fail,
	member,
	workspaceLock,
} from "./research-store.ts";
import {
	assertPublicationMetadataSafe,
	publicationSecrets,
} from "./research-publication-values.ts";
import {
	assignmentRecordSchema,
	inspectionActorSchema,
	inspectionIdSchema,
	inspectionInstantSchema,
	reportRecordSchema,
	type InspectionActor,
} from "./research-inspection-contracts.ts";

export interface InspectionCaller {
	actor: InspectionActor;
	role: "owner" | "member";
}
export function assertInspectionSafe(value: unknown): void {
	try {
		assertPublicationMetadataSafe(value, publicationSecrets());
	} catch {
		fail("INVALID_REQUEST");
	}
}
export function parseInspectionRequest<T extends { requestId: string }>(
	schema: z.ZodType<T>,
	body: unknown,
): T {
	const parsed = schema.safeParse(body);
	if (!parsed.success) return fail("INVALID_REQUEST");
	const input = {
		...parsed.data,
		requestId: parsed.data.requestId.toLowerCase(),
	};
	assertInspectionSafe(input);
	return input;
}
export async function inspectionActor(
	db: LocationDatabase,
	workspaceId: string,
	userId: string,
): Promise<InspectionCaller> {
	const membership = await member(db, workspaceId, userId);
	const role = z.enum(["owner", "member"]).parse(membership.role);
	const [user] = await db.query('SELECT id,name FROM "User" WHERE id=$1', [
		userId,
	]);
	if (!user) return fail("UNAUTHENTICATED", 401);
	const actor = inspectionActorSchema.parse({
		id: userId,
		displayName: user.name,
	});
	assertInspectionSafe(actor);
	return { actor, role };
}
export function inspectionWrite<T>(
	db: LocationDatabase,
	workspaceId: string,
	userId: string,
	action: (tx: LocationDatabase, caller: InspectionCaller) => Promise<T>,
): Promise<T> {
	return db.transaction(async (tx) => {
		await workspaceLock(tx, workspaceId);
		return action(tx, await inspectionActor(tx, workspaceId, userId));
	});
}
export async function requireInspectionLocation(
	db: LocationDatabase,
	workspaceId: string,
	locationId: string,
): Promise<void> {
	if (!inspectionIdSchema.safeParse(locationId).success)
		return fail("INVALID_REQUEST");
	const [row] = await db.query(
		'SELECT id FROM "MonitoringLocation" WHERE id=$1 AND "workspaceId"=$2',
		[locationId, workspaceId],
	);
	if (!row) fail("NOT_FOUND", 404);
}
export async function readInspectionAssignment(
	db: LocationDatabase,
	workspaceId: string,
	id: string,
	lock = false,
) {
	if (!inspectionIdSchema.safeParse(id).success) return fail("INVALID_REQUEST");
	const [row] = await db.query(
		`SELECT * FROM "InspectionAssignment" WHERE id=$1 AND "workspaceId"=$2${lock ? " FOR UPDATE" : ""}`,
		[id, workspaceId],
	);
	return row ? assignmentRecordSchema.parse(row) : fail("NOT_FOUND", 404);
}
export async function readInspectionReport(
	db: LocationDatabase,
	workspaceId: string,
	id: string,
	lock = false,
) {
	if (!inspectionIdSchema.safeParse(id).success) return fail("INVALID_REQUEST");
	const [row] = await db.query(
		`SELECT * FROM "P1InspectionReport" WHERE id=$1 AND "workspaceId"=$2${lock ? " FOR UPDATE" : ""}`,
		[id, workspaceId],
	);
	return row ? reportRecordSchema.parse(row) : fail("NOT_FOUND", 404);
}
export async function validateInspectionTime(
	db: LocationDatabase,
	observedAt: string,
): Promise<void> {
	const [row] = await db.query("SELECT clock_timestamp() AS now");
	if (
		/\.\d{4,}/.test(observedAt) ||
		Date.parse(observedAt) > Date.parse(inspectionInstantSchema.parse(row?.now))
	)
		fail("INVALID_REQUEST");
}

const pageSchema = z
	.object({
		limit: z.coerce.number().int().min(1).max(100).default(50),
		cursor: z.string().min(1).max(2048).nullish(),
	})
	.strict();
const positionSchema = z
	.object({
		createdAt: z.string().datetime({ offset: true }),
		id: inspectionIdSchema,
	})
	.strict();
export function inspectionPage(query: unknown, scope: string) {
	const parsed = pageSchema.safeParse(query);
	if (!parsed.success) return fail("INVALID_REQUEST");
	let position: z.infer<typeof positionSchema> | undefined;
	if (parsed.data.cursor) {
		const after = cursorRead(parsed.data.cursor, scope);
		try {
			position = positionSchema.parse(
				typeof after === "string" ? JSON.parse(after) : null,
			);
		} catch {
			return fail("INVALID_REQUEST");
		}
	}
	return { limit: parsed.data.limit, position };
}
export function inspectionNextCursor(
	items: { id: string; createdAt: string }[],
	hasMore: boolean,
	scope: string,
): string | null {
	const last = items.at(-1);
	return hasMore && last
		? cursorWrite(
				scope,
				JSON.stringify({ id: last.id, createdAt: last.createdAt }),
			)
		: null;
}
