import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { applyResearchMigrations } from "./helpers/research-publication-fixtures.mjs";
import {
	inspectionFixture,
	loadInspectionModule,
	sqlAdapter,
	Storage,
} from "./helpers/research-inspection-fixtures.mjs";

const { createResearchInspectionHandlers } = await loadInspectionModule(
	"research-inspections-http",
);
let pg,
	root,
	db,
	f,
	handlers,
	dependencies,
	sequence = 0;
before(async () => {
	pg = await PGlite.create();
	root = await mkdtemp(path.join(tmpdir(), "inspections-api-"));
});
after(async () => {
	await pg?.close();
	if (root) await rm(root, { recursive: true, force: true });
});
beforeEach(async () => {
	await pg.exec(
		`CREATE SCHEMA inspections_api_${++sequence}; SET search_path TO inspections_api_${sequence}, public`,
	);
	await applyResearchMigrations(pg);
	db = sqlAdapter(pg);
	f = await inspectionFixture(
		db,
		new Storage(path.join(root, String(sequence))),
	);
	dependencies = {
		session: async () => ({ user: { id: f.owner } }),
		database: () => db,
		enabled: () => true,
	};
	handlers = createResearchInspectionHandlers(dependencies);
});
const ctx = (extra = {}) => ({
	params: Promise.resolve({
		workspaceId: f.workspace,
		locationId: f.location.id,
		...extra,
	}),
});
const req = (method = "GET", body, query = "") =>
	new Request(`http://localhost/api/v2/inspections${query}`, {
		method,
		...(body === undefined
			? {}
			: {
					body: JSON.stringify(body),
					headers: { "Content-Type": "application/json" },
				}),
	});
const check = async (response, status, code) => {
	assert.equal(response.status, status);
	assert.equal(response.headers.get("cache-control"), "private, no-store");
	const body = await response.json();
	if (code) assert.equal(body.code, code);
	return body;
};
const assign = async () =>
	check(
		await handlers.createAssignment(
			req("POST", { requestId: randomUUID(), assigneeUserId: f.inspector }),
			ctx(),
		),
		201,
	);
const reportBody = () => ({
	requestId: randomUUID(),
	inspectorUserId: f.inspector,
	observedAt: "2026-08-01T00:00:00.000Z",
	outcome: "inconclusive",
	notes: "Synthetic private notes",
});

test("all six operations follow public DTOs and keep save separate from completion", async () => {
	const a = await assign();
	const list = await check(await handlers.listAssignments(req(), ctx()), 200);
	assert.equal(list.items[0].id, a.id);
	const report = await check(
		await handlers.createReport(
			req("POST", reportBody()),
			ctx({ assignmentId: a.id }),
		),
		201,
	);
	const completed = await check(
		await handlers.updateAssignment(
			req("PATCH", {
				requestId: randomUUID(),
				expectedRevision: 1,
				status: "completed",
			}),
			ctx({ assignmentId: a.id }),
		),
		200,
	);
	assert.equal(completed.status, "completed");
	const corrected = await check(
		await handlers.correctReport(
			req("PATCH", {
				...reportBody(),
				expectedRevision: 1,
				reason: "Correcting evidence",
				notes: "Corrected notes",
			}),
			ctx({ reportId: report.id }),
		),
		200,
	);
	assert.equal(corrected.corrections[0].notes, report.notes);
	const reports = await check(await handlers.listReports(req(), ctx()), 200);
	assert.equal(reports.items[0].revision, 2);
});

test("idempotency, revision conflict and invalid transitions map to distinct safe responses", async () => {
	const body = { requestId: randomUUID(), assigneeUserId: f.inspector };
	const a = await check(
		await handlers.createAssignment(req("POST", body), ctx()),
		201,
	);
	assert.deepEqual(
		await check(await handlers.createAssignment(req("POST", body), ctx()), 201),
		a,
	);
	await check(
		await handlers.createAssignment(
			req("POST", { ...body, assigneeUserId: f.other }),
			ctx(),
		),
		409,
		"IDEMPOTENCY_CONFLICT",
	);
	await check(
		await handlers.updateAssignment(
			req("PATCH", {
				requestId: randomUUID(),
				expectedRevision: 2,
				status: "cancelled",
			}),
			ctx({ assignmentId: a.id }),
		),
		409,
		"REVISION_CONFLICT",
	);
	await check(
		await handlers.updateAssignment(
			req("PATCH", {
				requestId: randomUUID(),
				expectedRevision: 1,
				status: "completed",
			}),
			ctx({ assignmentId: a.id }),
		),
		400,
		"INVALID_REQUEST",
	);
});

test("authentication, feature gate, authorization and malformed requests fail privately", async () => {
	for (const [overrides, status, code] of [
		[{ session: async () => null }, 401, "UNAUTHENTICATED"],
		[{ enabled: () => false }, 503, "DEPENDENCY_UNAVAILABLE"],
		[{ session: async () => ({ user: { id: "outsider" } }) }, 403, "FORBIDDEN"],
	]) {
		const h = createResearchInspectionHandlers({
			...dependencies,
			...overrides,
		});
		await check(await h.listAssignments(req(), ctx()), status, code);
	}
	await check(
		await handlers.createAssignment(
			req("POST", {
				requestId: randomUUID(),
				assigneeUserId: f.inspector,
				assignedBy: { id: f.other },
			}),
			ctx(),
		),
		400,
		"INVALID_REQUEST",
	);
	await check(
		await handlers.createAssignment(
			new Request("http://localhost/", { method: "POST", body: "{" }),
			ctx(),
		),
		400,
		"INVALID_REQUEST",
	);
	for (const query of [
		"?limit=101",
		"?limit=0",
		"?cursor=invalid",
		"?limit=2&limit=3",
		"?unapproved=value",
	])
		await check(
			await handlers.listReports(req("GET", undefined, query), ctx()),
			400,
			"INVALID_REQUEST",
		);
	const foreign = req("POST", {});
	foreign.headers.set("Origin", "https://foreign.invalid");
	await check(
		await handlers.createAssignment(foreign, ctx()),
		403,
		"FORBIDDEN",
	);
});

test("driver errors, forged error codes and configured secrets never reach responses or audit", async () => {
	for (const error of [
		new Error("postgresql://user:private-secret-sentinel@host/db"),
		Object.assign(new Error("private-secret-sentinel"), {
			code: "private-secret-sentinel",
		}),
	]) {
		const h = createResearchInspectionHandlers({
			...dependencies,
			database: () => {
				throw error;
			},
		});
		const body = await check(
			await h.listAssignments(req(), ctx()),
			500,
			"INTERNAL_ERROR",
		);
		assert.doesNotMatch(
			JSON.stringify(body),
			/private-secret|postgresql|stack/,
		);
	}
	const a = await assign();
	const previous = process.env.AUTH_SECRET;
	process.env.AUTH_SECRET = "private-configured-secret-sentinel";
	try {
		await check(
			await handlers.createReport(
				req("POST", { ...reportBody(), notes: process.env.AUTH_SECRET }),
				ctx({ assignmentId: a.id }),
			),
			400,
			"INVALID_REQUEST",
		);
		assert.doesNotMatch(
			JSON.stringify(await db.query('SELECT * FROM "InspectionAuditEvent"')),
			/private-configured-secret|Synthetic private notes/,
		);
	} finally {
		if (previous === undefined) delete process.env.AUTH_SECRET;
		else process.env.AUTH_SECRET = previous;
	}
});
