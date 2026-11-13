import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { applyResearchMigrations } from "./helpers/research-publication-fixtures.mjs";
import {
	assignments,
	reports,
	inspectionFixture,
	sqlAdapter,
	Storage,
} from "./helpers/research-inspection-fixtures.mjs";

let pg,
	root,
	db,
	f,
	sequence = 0;
before(async () => {
	pg = await PGlite.create();
	root = await mkdtemp(path.join(tmpdir(), "research-inspections-"));
});
after(async () => {
	await pg?.close();
	if (root) await rm(root, { recursive: true, force: true });
});
beforeEach(async () => {
	await pg.exec(
		`CREATE SCHEMA inspections_${++sequence}; SET search_path TO inspections_${sequence}, public`,
	);
	await applyResearchMigrations(pg);
	db = sqlAdapter(pg);
	f = await inspectionFixture(
		db,
		new Storage(path.join(root, String(sequence))),
	);
});
const assignmentBody = () => ({
	requestId: randomUUID(),
	assigneeUserId: f.inspector,
});
const reportBody = () => ({
	requestId: randomUUID(),
	inspectorUserId: f.inspector,
	observedAt: "2026-08-01T01:00:00.000Z",
	outcome: "inconclusive",
	notes: "Synthetic inspection",
});
const createAssignment = (body = assignmentBody(), actor = f.owner) =>
	assignments.createInspectionAssignment(
		db,
		f.workspace,
		actor,
		f.location.id,
		body,
	);
const createReport = (id, body = reportBody(), actor = f.recorder) =>
	reports.createResearchReport(db, f.workspace, actor, id, body);
const patch = (a, status, extra = {}, actor = f.inspector) =>
	assignments.updateInspectionAssignment(db, f.workspace, actor, a.id, {
		requestId: randomUUID(),
		expectedRevision: a.revision,
		status,
		...extra,
	});
const rejects = (run, code) =>
	assert.rejects(run, (error) => error.code === code);
const rows = (table) => db.query(`SELECT * FROM "${table}" ORDER BY id`);

test("OAuth secrets are rejected from inspection notes, correction metadata and actor snapshots", async () => {
	const a = await createAssignment();
	const report = await createReport(a.id);
	const previous = process.env.AUTH_GOOGLE_SECRET;
	process.env.AUTH_GOOGLE_SECRET = 'synthetic-inspection/private:"sentinel';
	try {
		for (const variant of [
			process.env.AUTH_GOOGLE_SECRET,
			encodeURIComponent(process.env.AUTH_GOOGLE_SECRET),
		]) {
			await rejects(
				() => createReport(a.id, { ...reportBody(), notes: variant }),
				"INVALID_REQUEST",
			);
			await rejects(
				() =>
					reports.correctResearchReport(
						db,
						f.workspace,
						f.recorder,
						report.id,
						{ ...reportBody(), expectedRevision: 1, reason: variant },
					),
				"INVALID_REQUEST",
			);
			await db.query('UPDATE "User" SET name=$1 WHERE id=$2', [
				variant,
				f.owner,
			]);
			await rejects(() => createAssignment(), "INVALID_REQUEST");
		}
		assert.equal((await rows("P1InspectionReport")).length, 1);
		assert.equal((await rows("P1InspectionReportRevision")).length, 0);
		assert.equal((await rows("InspectionAuditEvent")).length, 2);
	} finally {
		if (previous === undefined) delete process.env.AUTH_GOOGLE_SECRET;
		else process.env.AUTH_GOOGLE_SECRET = previous;
	}
});

test("assignment creation preserves server identities and idempotent receipts", async () => {
	const body = assignmentBody();
	const first = await createAssignment(body);
	assert.equal(first.status, "assigned");
	assert.equal(first.revision, 1);
	assert.equal(first.assignee.id, f.inspector);
	assert.equal(first.assignedBy.id, f.owner);
	assert.deepEqual(
		await createAssignment({
			...body,
			requestId: body.requestId.toUpperCase(),
		}),
		first,
	);
	await rejects(
		() => createAssignment({ ...body, assigneeUserId: f.other }),
		"IDEMPOTENCY_CONFLICT",
	);
	assert.equal((await rows("InspectionAuditEvent")).length, 1);
});

test("strict requests and active workspace membership apply to actors and targets", async () => {
	await rejects(
		() =>
			createAssignment({ ...assignmentBody(), assignedBy: { id: f.other } }),
		"INVALID_REQUEST",
	);
	await rejects(
		() => createAssignment(assignmentBody(), "outsider"),
		"FORBIDDEN",
	);
	await db.query(
		'UPDATE "Membership" SET active=false WHERE "workspaceId"=$1 AND "userId"=$2',
		[f.workspace, f.inspector],
	);
	await rejects(() => createAssignment(), "FORBIDDEN");
});

test("only assignee, assigner and owner may change status; completion requires a report", async () => {
	const a = await createAssignment(assignmentBody(), f.recorder);
	await rejects(() => patch(a, "in_progress", {}, f.other), "FORBIDDEN");
	await rejects(() => patch(a, "completed"), "INVALID_REQUEST");
	const running = await patch(a, "in_progress");
	await rejects(() => patch(a, "cancelled"), "REVISION_CONFLICT");
	const report = await createReport(a.id);
	assert.equal(report.recordedBy.id, f.recorder);
	assert.equal(report.inspectorUserId, f.inspector);
	const completed = await patch(running, "completed", {}, f.owner);
	assert.equal(completed.status, "completed");
	await rejects(() => patch(completed, "in_progress"), "INVALID_REQUEST");
	await rejects(() => createReport(completed.id), "INVALID_REQUEST");
});

test("successful report/status retries survive terminal status and later revisions", async () => {
	const a = await createAssignment();
	const body = reportBody();
	const report = await createReport(a.id, body);
	assert.equal(
		(
			await assignments.listInspectionAssignments(
				db,
				f.workspace,
				f.owner,
				f.location.id,
			)
		).items[0].status,
		"assigned",
	);
	const statusBody = {
		requestId: randomUUID(),
		expectedRevision: 1,
		status: "completed",
	};
	const completed = await assignments.updateInspectionAssignment(
		db,
		f.workspace,
		f.inspector,
		a.id,
		statusBody,
	);
	assert.deepEqual(await createReport(a.id, body), report);
	assert.deepEqual(
		await assignments.updateInspectionAssignment(
			db,
			f.workspace,
			f.inspector,
			a.id,
			statusBody,
		),
		completed,
	);
	assert.equal((await rows("InspectionAuditEvent")).length, 3);
});

test("reports reject future times, forged context and inactive inspectors", async () => {
	const a = await createAssignment();
	await rejects(
		() =>
			createReport(a.id, {
				...reportBody(),
				observedAt: "2999-01-01T00:00:00Z",
			}),
		"INVALID_REQUEST",
	);
	await rejects(
		() => createReport(a.id, { ...reportBody(), locationId: f.location.id }),
		"INVALID_REQUEST",
	);
	await db.query(
		'UPDATE "Membership" SET active=false WHERE "workspaceId"=$1 AND "userId"=$2',
		[f.workspace, f.inspector],
	);
	await rejects(() => createReport(a.id), "FORBIDDEN");
});

test("corrections append new versions while the DTO retains each previous state", async () => {
	const a = await createAssignment();
	const original = await createReport(a.id);
	const body = {
		...reportBody(),
		expectedRevision: 1,
		reason: "Synthetic correction",
		notes: "Corrected notes",
		outcome: "no_sign_at_inspection",
	};
	const updated = await reports.correctResearchReport(
		db,
		f.workspace,
		f.recorder,
		original.id,
		body,
	);
	assert.equal(updated.revision, 2);
	assert.equal(updated.notes, body.notes);
	assert.equal(updated.recordedBy.id, original.recordedBy.id);
	assert.equal(updated.corrections[0].notes, original.notes);
	assert.equal(updated.corrections[0].revision, 1);
	assert.equal(updated.corrections[0].correctedBy.id, f.recorder);
	assert.equal((await rows("P1InspectionReport"))[0].notes, original.notes);
	const third = await reports.correctResearchReport(
		db,
		f.workspace,
		f.owner,
		original.id,
		{
			...body,
			requestId: randomUUID(),
			expectedRevision: 2,
			notes: "Third state",
		},
	);
	assert.equal(third.revision, 3);
	assert.equal(third.corrections[1].notes, body.notes);
	assert.deepEqual(
		await reports.correctResearchReport(
			db,
			f.workspace,
			f.recorder,
			original.id,
			body,
		),
		updated,
	);
	await rejects(
		() =>
			reports.correctResearchReport(db, f.workspace, f.recorder, original.id, {
				...body,
				notes: "changed retry",
			}),
		"IDEMPOTENCY_CONFLICT",
	);
	await rejects(
		() =>
			reports.correctResearchReport(db, f.workspace, f.recorder, original.id, {
				...body,
				requestId: randomUUID(),
			}),
		"REVISION_CONFLICT",
	);
	await rejects(
		() =>
			reports.correctResearchReport(db, f.workspace, f.inspector, original.id, {
				...body,
				requestId: randomUUID(),
				expectedRevision: 3,
			}),
		"FORBIDDEN",
	);
});

test("multiple assignments/reports preserve the location anchor and immutable result", async () => {
	const a = await createAssignment();
	const b = await createAssignment();
	await createReport(a.id);
	await createReport(a.id);
	await createReport(b.id);
	const list = await reports.listResearchReports(
		db,
		f.workspace,
		f.owner,
		f.location.id,
		{ limit: 2 },
	);
	assert.equal(list.items.length, 2);
	assert.ok(list.nextCursor);
	const rest = await reports.listResearchReports(
		db,
		f.workspace,
		f.owner,
		f.location.id,
		{ limit: 2, cursor: list.nextCursor },
	);
	assert.equal(rest.items.length, 1);
	assert.equal(rest.nextCursor, null);
	const [location] = await rows("MonitoringLocation");
	assert.deepEqual(location.anchor, f.location.anchor);
	assert.equal(location.initialAnalysisId, f.analysisId);
	assert.equal((await rows("AnalysisResult")).length, 1);
});

test("workspace isolation and revoked callers apply even to successful retries", async () => {
	const body = assignmentBody();
	const a = await createAssignment(body);
	await db.query(
		"INSERT INTO \"Workspace\" (id,name,\"createdById\") VALUES ('foreign','Foreign',$1)",
		[f.owner],
	);
	await db.query(
		'INSERT INTO "Membership" ("workspaceId","userId",role) VALUES (\'foreign\',$1,\'owner\')',
		[f.owner],
	);
	await rejects(
		() =>
			assignments.updateInspectionAssignment(db, "foreign", f.owner, a.id, {
				requestId: randomUUID(),
				expectedRevision: 1,
				status: "cancelled",
			}),
		"NOT_FOUND",
	);
	await rejects(
		() =>
			reports.createResearchReport(db, "foreign", f.owner, a.id, reportBody()),
		"NOT_FOUND",
	);
	await db.query(
		'UPDATE "Membership" SET active=false WHERE "workspaceId"=$1 AND "userId"=$2',
		[f.workspace, f.owner],
	);
	await rejects(() => createAssignment(body), "FORBIDDEN");
});

test("database guards reject unaudited status changes and mutation of every history table", async () => {
	const a = await createAssignment();
	const report = await createReport(a.id);
	await reports.correctResearchReport(db, f.workspace, f.recorder, report.id, {
		...reportBody(),
		expectedRevision: 1,
		reason: "Correction",
	});
	await assert.rejects(
		db.transaction((tx) =>
			tx.query(
				"UPDATE \"InspectionAssignment\" SET status='in_progress',revision=revision+1 WHERE id=$1",
				[a.id],
			),
		),
	);
	for (const table of [
		"P1InspectionReport",
		"P1InspectionReportRevision",
		"InspectionAuditEvent",
	]) {
		await assert.rejects(
			db.query(`UPDATE "${table}" SET "workspaceId"='foreign'`),
		);
		await assert.rejects(db.query(`DELETE FROM "${table}"`));
		await assert.rejects(db.query(`TRUNCATE "${table}" CASCADE`));
	}
	assert.equal((await rows("InspectionAssignment"))[0].revision, 1);
});

test("assigners can update their tasks and owner-only correction receipts require current permissions", async () => {
	const a = await createAssignment(assignmentBody(), f.recorder);
	const running = await patch(a, "in_progress", {}, f.recorder);
	assert.equal(running.status, "in_progress");
	const report = await createReport(a.id);
	const body = {
		...reportBody(),
		expectedRevision: 1,
		reason: "Owner correction",
	};
	await reports.correctResearchReport(
		db,
		f.workspace,
		f.owner,
		report.id,
		body,
	);
	await db.query(
		'UPDATE "Membership" SET role=\'member\' WHERE "workspaceId"=$1 AND "userId"=$2',
		[f.workspace, f.owner],
	);
	await rejects(
		() =>
			reports.correctResearchReport(db, f.workspace, f.owner, report.id, body),
		"FORBIDDEN",
	);
});

test("audit failure rolls back business state and idempotency atomically", async () => {
	await pg.exec(
		`CREATE FUNCTION reject_inspection_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private-database-sentinel'; END; $$; CREATE TRIGGER reject_audit BEFORE INSERT ON "InspectionAuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_inspection_audit()`,
	);
	await assert.rejects(createAssignment());
	assert.equal((await rows("InspectionAssignment")).length, 0);
	assert.equal((await rows("InspectionAuditEvent")).length, 0);
});
