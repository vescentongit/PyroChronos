import { z } from "zod";
import type { LocationDatabase } from "./monitoring-locations.ts";
import type { ResearchArtifactReader } from "./research-observations.ts";
import { iterateResearchObservations } from "./research-observations.ts";
import { p1JobWire } from "./research-analysis-submissions.ts";
import {
	researchAnalysisResultSchema,
	researchDailyPageSchema,
	researchDetectionsPageSchema,
	researchJobSchema,
} from "./research-contracts.ts";
import { analysisArtifactSchema } from "./research-foundation-contracts.ts";
import { publicationChecksum } from "./research-publication-values.ts";
import {
	cursorRead,
	cursorWrite,
	fail,
	getArtifact,
	getJobRow,
	jobWire,
	member,
	resultWire,
} from "./research-store.ts";

export async function readResearchJob(
	db: LocationDatabase,
	workspaceId: string,
	userId: string,
	id: string,
	requestId: string | null = null,
) {
	await member(db, workspaceId, userId);
	const [row] = await db.query(
		'SELECT * FROM "P1AnalysisJob" WHERE id=$1 AND "workspaceId"=$2',
		[id, workspaceId],
	);
	if (requestId !== null && !z.string().uuid().safeParse(requestId).success) return fail("INVALID_REQUEST");
	if (row) {
		if (requestId !== null) {
			const [receipt] = await db.query('SELECT response FROM "ResearchRequest" WHERE scope=$1 AND "requestId"=$2', [`analysis:${workspaceId}:${userId}`, requestId.toLowerCase()]);
			const response = researchJobSchema.safeParse(receipt?.response);
			if (!response.success || response.data.id !== id) return fail("NOT_FOUND", 404);
		}
		return p1JobWire(row, requestId?.toLowerCase());
	}
	const legacy = jobWire(await getJobRow(db, workspaceId, id));
	if (requestId !== null && requestId.toLowerCase() !== legacy.requestId.toLowerCase()) return fail("NOT_FOUND", 404);
	return legacy;
}

async function analysisContext(
	db: LocationDatabase,
	workspaceId: string,
	userId: string,
	id: string,
) {
	await member(db, workspaceId, userId);
	const [row] = await db.query(
		'SELECT r.payload FROM "AnalysisResult" r JOIN "P1AnalysisJob" j ON j.id=r."jobId" AND j."workspaceId"=r."workspaceId" WHERE r.id=$1 AND r."workspaceId"=$2 AND j.status=\'succeeded\' AND j."resultId"=r.id',
		[id, workspaceId],
	);
	if (row) {
		const result = researchAnalysisResultSchema.parse(row.payload);
		if (result.id !== id || result.workspaceId !== workspaceId)
			return fail("DEPENDENCY_UNAVAILABLE", 503);
		return { kind: "p1" as const, result };
	}
	const legacy = await getArtifact(db, workspaceId, id);
	return {
		kind: "p0" as const,
		result: resultWire(legacy.job, legacy.artifact),
		legacy,
	};
}

export async function readResearchAnalysis(
	db: LocationDatabase,
	workspaceId: string,
	userId: string,
	id: string,
) {
	return (await analysisContext(db, workspaceId, userId, id)).result;
}

const daysDocument = z.union([
	researchDailyPageSchema,
	z.array(researchDailyPageSchema).min(1).max(1200),
]);
export async function readResearchDays(
	db: LocationDatabase,
	reader: ResearchArtifactReader,
	workspaceId: string,
	userId: string,
	id: string,
	role: string,
	month: string,
) {
	const context = await analysisContext(db, workspaceId, userId, id);
	if (
		!["primary", "comparison"].includes(role) ||
		(role === "comparison" && !context.result.comparison) ||
		!/^\d{4}-\d{2}$/.test(month)
	)
		return fail("INVALID_REQUEST");
	if (context.kind === "p0") {
		const pages = z
			.array(researchDailyPageSchema)
			.parse(context.legacy.artifact.days);
		const page = pages.find((p) => p.periodRole === role && p.month === month);
		return page ? { ...page, analysisId: id } : fail("NOT_FOUND", 404);
	}
	const rows = await db.query(
		'SELECT * FROM "P1AnalysisArtifact" WHERE "resultId"=$1 AND "workspaceId"=$2 AND kind=\'daily\' AND "periodRole"=$3 ORDER BY id LIMIT 129',
		[id, workspaceId, role],
	);
	if (!rows.length || rows.length > 128)
		return fail("DEPENDENCY_UNAVAILABLE", 503);
	let total = 0;
	for (const row of rows) {
		const artifact = analysisArtifactSchema.parse({
			...row,
			bytes: Number(row.bytes),
		});
		total += artifact.bytes;
		if (artifact.format !== "json" || total > 64 * 1024 * 1024)
			return fail("DEPENDENCY_UNAVAILABLE", 503);
		const bytes = await reader.read(
			artifact.objectKey,
			artifact.checksum,
			artifact.bytes,
		);
		if (
			bytes.byteLength !== artifact.bytes ||
			publicationChecksum(bytes) !== artifact.checksum
		)
			return fail("DEPENDENCY_UNAVAILABLE", 503);
		const document = daysDocument.parse(
			JSON.parse(Buffer.from(bytes).toString("utf8")),
		);
		for (const page of Array.isArray(document) ? document : [document]) {
			if (page.analysisId !== id || page.periodRole !== role)
				return fail("DEPENDENCY_UNAVAILABLE", 503);
			if (page.month === month) {
				await member(db, workspaceId, userId);
				return page;
			}
		}
	}
	return fail("NOT_FOUND", 404);
}

async function observations(
	db: LocationDatabase,
	reader: ResearchArtifactReader,
	workspaceId: string,
	userId: string,
	id: string,
	role: string,
) {
	const context = await analysisContext(db, workspaceId, userId, id);
	if (role !== "primary" && role !== "comparison")
		return fail("INVALID_REQUEST");
	if (role === "comparison" && !context.result.comparison)
		return fail("INVALID_REQUEST");
	const items: z.infer<typeof researchDetectionsPageSchema>["observations"] =
		[];
	if (context.kind === "p1")
		for await (const observation of iterateResearchObservations(
			db,
			reader,
			context.result,
			{ periodRole: role },
		))
			items.push(observation);
	else {
		const runId = z.string().parse(context.legacy.job.runId);
		const rows = await db.query(
			'SELECT payload FROM "ResearchObservation" WHERE "runId"=$1 AND "periodRole"=$2 ORDER BY ordinal LIMIT 1000001',
			[runId, role],
		);
		if (rows.length > 1000000) return fail("CAPACITY_LIMIT", 503);
		for (const row of rows)
			items.push(
				researchDetectionsPageSchema.shape.observations.element.parse(
					row.payload,
				),
			);
	}
	return items.sort(
		(a, b) =>
			a.observedAt.localeCompare(b.observedAt) || a.id.localeCompare(b.id),
	);
}

export async function readResearchDetections(
	db: LocationDatabase,
	reader: ResearchArtifactReader,
	workspaceId: string,
	userId: string,
	id: string,
	role: string,
	cursor: string | null,
	limit = 1000,
) {
	if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
		return fail("INVALID_REQUEST");
	const scope = `detections:${workspaceId}:${id}:${role}`;
	const after = cursorRead(cursor, scope) ?? -1;
	if (typeof after !== "number" || !Number.isSafeInteger(after) || after < -1)
		return fail("INVALID_REQUEST");
	const items = await observations(db, reader, workspaceId, userId, id, role);
	await member(db, workspaceId, userId);
	return researchDetectionsPageSchema.parse({
		schemaVersion: "research-2",
		analysisId: id,
		periodRole: role,
		observations: items.slice(after + 1, after + 1 + limit),
		nextCursor:
			items.length > after + 1 + limit
				? cursorWrite(scope, after + limit)
				: null,
	});
}

export async function readResearchTile(
	db: LocationDatabase,
	reader: ResearchArtifactReader,
	workspaceId: string,
	userId: string,
	id: string,
	role: string,
	zoom: number,
	x: number,
	y: number,
) {
	if (
		![zoom, x, y].every(Number.isInteger) ||
		zoom < 0 ||
		zoom > 16 ||
		x < 0 ||
		y < 0 ||
		x >= 2 ** zoom ||
		y >= 2 ** zoom
	)
		return fail("INVALID_REQUEST");
	const n = 2 ** zoom,
		west = (x / n) * 360 - 180,
		east = ((x + 1) / n) * 360 - 180;
	const latitude = (v: number) =>
		(Math.atan(Math.sinh(Math.PI * (1 - (2 * v) / n))) * 180) / Math.PI;
	const south = latitude(y + 1),
		north = latitude(y);
	const bins = new Map<
		string,
		{ longitude: number; latitude: number; count: number }
	>();
	for (const {
		coordinates: [lon, lat],
	} of await observations(db, reader, workspaceId, userId, id, role)) {
		if (lon < west || lon >= east || lat < south || lat >= north) continue;
		const column = Math.min(
				31,
				Math.floor(((lon - west) / (east - west)) * 32),
			),
			row = Math.min(31, Math.floor(((lat - south) / (north - south)) * 32));
		const key = `${column}:${row}`,
			old = bins.get(key);
		if (old) old.count++;
		else
			bins.set(key, {
				longitude: west + ((column + 0.5) * (east - west)) / 32,
				latitude: south + ((row + 0.5) * (north - south)) / 32,
				count: 1,
			});
	}
	await member(db, workspaceId, userId);
	return {
		type: "FeatureCollection",
		unit: "original-detection-count",
		features: [...bins.values()].map((bin) => ({
			type: "Feature",
			geometry: { type: "Point", coordinates: [bin.longitude, bin.latitude] },
			properties: { count: bin.count },
		})),
	};
}
