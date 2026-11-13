import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
	createMonitoringLocationSchema,
	monitoringLocationSchema,
} from "./research-contracts";
import {
	findOriginalObservation,
	readPublishedAnalysis,
	type ResearchArtifactReader,
} from "./monitoring-location-evidence";
import {
	cursorRead,
	cursorWrite,
	fail,
	hash,
	idempotent,
	member,
	workspaceLock,
} from "./research-store";

export interface LocationDatabase {
	query(
		statement: string,
		params?: unknown[],
	): Promise<Record<string, unknown>[]>;
	transaction<T>(run: (tx: LocationDatabase) => Promise<T>): Promise<T>;
}
export interface MonitoringLocationDependencies {
	database: LocationDatabase;
	artifacts: ResearchArtifactReader;
}
export type MonitoringLocation = z.infer<typeof monitoringLocationSchema>;
const idSchema = monitoringLocationSchema.shape.id;
const rowSchema = monitoringLocationSchema
	.omit({ schemaVersion: true })
	.extend({
		createdAt: z.coerce.date().transform((date) => date.toISOString()),
	})
	.strip();
const pageSchema = z
	.object({
		limit: z.coerce.number().int().min(1).max(100).default(50),
		cursor: z.string().min(1).max(2048).nullish(),
	})
	.strict();
const positionSchema = z
	.object({ createdAt: z.string().datetime({ offset: true }), id: idSchema })
	.strict();
const toLocation = (row: unknown): MonitoringLocation =>
	monitoringLocationSchema.parse({
		schemaVersion: "research-2",
		...rowSchema.parse(row),
	});

async function locationRow(
	db: LocationDatabase,
	workspaceId: string,
	locationId: string,
): Promise<MonitoringLocation> {
	if (!idSchema.safeParse(locationId).success) return fail("INVALID_REQUEST");
	const [row] = await db.query(
		'SELECT * FROM "MonitoringLocation" WHERE id=$1 AND "workspaceId"=$2',
		[locationId, workspaceId],
	);
	return row ? toLocation(row) : fail("NOT_FOUND", 404);
}

export async function createMonitoringLocation(
	dependencies: MonitoringLocationDependencies,
	workspaceId: string,
	userId: string,
	body: unknown,
): Promise<MonitoringLocation> {
	const parsed = createMonitoringLocationSchema.safeParse(body);
	if (
		!parsed.success ||
		/^cluster(?:[:/_-]|$)/i.test(parsed.data.anchorDetectionId)
	)
		return fail("INVALID_REQUEST");
	const input = {
		...parsed.data,
		requestId: parsed.data.requestId.toLowerCase(),
	};
	return dependencies.database.transaction(async (tx) => {
		await workspaceLock(tx, workspaceId);
		await member(tx, workspaceId, userId);
		const response = await idempotent(
			tx,
			`location:${workspaceId}:${userId}`,
			input.requestId,
			input,
			async () => {
				const result = await readPublishedAnalysis(
					tx,
					workspaceId,
					input.analysisId,
				);
				const anchor = await findOriginalObservation(
					tx,
					dependencies.artifacts,
					result,
					input.anchorDetectionId,
				);
				const [actor] = await tx.query(
					'SELECT id,name FROM "User" WHERE id=$1',
					[userId],
				);
				if (!actor) return fail("UNAUTHENTICATED", 401);
				const createdBy = monitoringLocationSchema.shape.createdBy.parse({
					id: userId,
					displayName: actor.name,
				});
				const [row] = await tx.query(
					`INSERT INTO "MonitoringLocation"
				(id,"workspaceId","requestId","requestHash",name,"anchorDetectionId",anchor,"initialAnalysisId","areaId","areaRevision","createdById","createdBy")
				VALUES ($1,$2,$3::uuid,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12::jsonb) RETURNING *`,
					[
						randomUUID(),
						workspaceId,
						input.requestId,
						hash(input),
						input.name,
						anchor.id,
						JSON.stringify(anchor),
						result.id,
						result.area.id,
						result.area.revision,
						userId,
						JSON.stringify(createdBy),
					],
				);
				const location = toLocation(row);
				await appendAnalysis(tx, workspaceId, location.id, result.id);
				return { value: location, status: 201 };
			},
		);
		return monitoringLocationSchema.parse(response.value);
	});
}

export async function getMonitoringLocation(
	dependencies: Pick<MonitoringLocationDependencies, "database">,
	workspaceId: string,
	userId: string,
	locationId: string,
): Promise<MonitoringLocation> {
	await member(dependencies.database, workspaceId, userId);
	return locationRow(dependencies.database, workspaceId, locationId);
}

export async function listMonitoringLocations(
	dependencies: Pick<MonitoringLocationDependencies, "database">,
	workspaceId: string,
	userId: string,
	query: unknown = {},
): Promise<{ items: MonitoringLocation[]; nextCursor: string | null }> {
	await member(dependencies.database, workspaceId, userId);
	const parsed = pageSchema.safeParse(query);
	if (!parsed.success) return fail("INVALID_REQUEST");
	const scope = `locations:${workspaceId}`;
	let position: z.infer<typeof positionSchema> | undefined;
	if (parsed.data.cursor) {
		const after = cursorRead(parsed.data.cursor, scope);
		if (typeof after !== "string") return fail("INVALID_REQUEST");
		try {
			position = positionSchema.parse(JSON.parse(after));
		} catch {
			return fail("INVALID_REQUEST");
		}
	}
	const rows = await dependencies.database.query(
		`SELECT * FROM "MonitoringLocation" WHERE "workspaceId"=$1
		AND ($2::timestamptz IS NULL OR ("createdAt",id)>($2::timestamptz,$3::text)) ORDER BY "createdAt",id LIMIT $4`,
		[
			workspaceId,
			position?.createdAt ?? null,
			position?.id ?? null,
			parsed.data.limit + 1,
		],
	);
	const items = rows.slice(0, parsed.data.limit).map(toLocation);
	const last = items.at(-1);
	return {
		items,
		nextCursor:
			rows.length > parsed.data.limit && last
				? cursorWrite(
						scope,
						JSON.stringify({ createdAt: last.createdAt, id: last.id }),
					)
				: null,
	};
}

async function appendAnalysis(
	tx: LocationDatabase,
	workspaceId: string,
	locationId: string,
	analysisId: string,
): Promise<void> {
	await tx.query(
		'INSERT INTO "MonitoringLocationAnalysis" ("locationId","workspaceId","analysisId") VALUES ($1,$2,$3) ON CONFLICT ("locationId","analysisId") DO NOTHING',
		[locationId, workspaceId, analysisId],
	);
}

export async function linkMonitoringLocationAnalysis(
	dependencies: Pick<MonitoringLocationDependencies, "database">,
	workspaceId: string,
	userId: string,
	locationId: string,
	analysisId: string,
): Promise<void> {
	if (!idSchema.safeParse(analysisId).success) return fail("INVALID_REQUEST");
	await dependencies.database.transaction(async (tx) => {
		await workspaceLock(tx, workspaceId);
		await member(tx, workspaceId, userId);
		await locationRow(tx, workspaceId, locationId);
		await readPublishedAnalysis(tx, workspaceId, analysisId);
		await appendAnalysis(tx, workspaceId, locationId, analysisId);
	});
}
