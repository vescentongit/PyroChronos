import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import {
	assignments,
	reports,
	inspectionFixture,
	Storage,
} from "./helpers/research-inspection-fixtures.mjs";

const dsn = process.env.RESEARCH_TEST_DATABASE_URL;
const native = (name, run) => test(name, { skip: !dsn }, run);
let client, schema, root, db, f;
const sql = (connection) => ({
	query: (statement, params = []) =>
		connection.$queryRawUnsafe(statement, ...params),
	transaction: (run) =>
		connection.$transaction((tx) => run(sql(tx)), {
			maxWait: 10000,
			timeout: 20000,
		}),
});
function setup(operation) {
	const result = spawnSync(
		process.env.PYTHON || "python",
		[
			fileURLToPath(
				new URL("./helpers/research-publication-postgres.py", import.meta.url),
			),
			operation,
		],
		{
			env: { ...process.env, PUBLICATION_TEST_SCHEMA: schema },
			encoding: "utf8",
			timeout: 15000,
		},
	);
	assert.equal(
		result.status,
		0,
		"Dedicated native inspection database setup failed",
	);
}
beforeEach(async () => {
	if (!dsn) return;
	const url = new URL(dsn);
	assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
	assert.equal(url.pathname, "/research_worker_test");
	schema = `publication_test_${randomUUID().replaceAll("-", "")}`;
	setup("init");
	url.searchParams.set("schema", schema);
	client = new PrismaClient({ datasourceUrl: url.href });
	db = sql(client);
	root = await mkdtemp(path.join(tmpdir(), "inspections-native-"));
	f = await inspectionFixture(db, new Storage(root));
});
afterEach(async () => {
	if (!dsn) return;
	await client?.$disconnect();
	if (schema) setup("drop");
	if (root) await rm(root, { recursive: true, force: true });
});
const createAssignment = (
	body = { requestId: randomUUID(), assigneeUserId: f.inspector },
) =>
	assignments.createInspectionAssignment(
		db,
		f.workspace,
		f.owner,
		f.location.id,
		body,
	);
const reportBody = () => ({
	requestId: randomUUID(),
	inspectorUserId: f.inspector,
	observedAt: "2026-08-01T00:00:00.000Z",
	outcome: "inconclusive",
	notes: "Synthetic native report",
});
const createReport = (a, body = reportBody()) =>
	reports.createResearchReport(db, f.workspace, f.recorder, a.id, body);
const correct = (r, body, database = db) =>
	reports.correctResearchReport(database, f.workspace, f.recorder, r.id, body);

native(
	"PostgreSQL audit actor snapshots must match their immutable source records",
	async () => {
		const altered = {
			...db,
			transaction: (run) =>
				db.transaction((tx) =>
					run({
						...tx,
						query: (statement, params = []) => {
							if (!statement.startsWith('INSERT INTO "InspectionAuditEvent"'))
								return tx.query(statement, params);
							const changed = [...params];
							changed[8] = JSON.stringify({
								...JSON.parse(changed[8]),
								displayName: "Forged display snapshot",
							});
							return tx.query(statement, changed);
						},
					}),
				),
		};
		await assert.rejects(
			assignments.createInspectionAssignment(
				altered,
				f.workspace,
				f.owner,
				f.location.id,
				{ requestId: randomUUID(), assigneeUserId: f.inspector },
			),
		(error) => error.message.includes("Invalid inspection audit"),
		);
		const a = await createAssignment();
		await assert.rejects(
			reports.createResearchReport(
				altered,
				f.workspace,
				f.recorder,
				a.id,
				reportBody(),
			),
		(error) => error.message.includes("Invalid inspection audit"),
		);
		const report = await createReport(a);
		await assert.rejects(
			correct(
				report,
				{ ...reportBody(), expectedRevision: 1, reason: "Correction" },
				altered,
			),
		(error) => error.message.includes("Invalid inspection audit"),
		);
		assert.equal(await client.p1InspectionReportRevision.count(), 0);
		assert.equal(await client.inspectionAuditEvent.count(), 2);
	},
);

native(
	"PostgreSQL concurrent assignment/report retries create one effect and one audit each",
	async () => {
		const assignmentInput = {
			requestId: randomUUID(),
			assigneeUserId: f.inspector,
		};
		const created = await Promise.all(
			Array.from({ length: 6 }, () => createAssignment(assignmentInput)),
		);
		assert.ok(created.every((a) => a.id === created[0].id));
		const body = reportBody();
		const results = await Promise.all(
			Array.from({ length: 6 }, () => createReport(created[0], body)),
		);
		assert.ok(results.every((r) => r.id === results[0].id));
		assert.equal(await client.inspectionAssignment.count(), 1);
		assert.equal(await client.p1InspectionReport.count(), 1);
		assert.equal(await client.inspectionAuditEvent.count(), 2);
	},
);

native(
	"PostgreSQL competing status changes and corrections have one revision winner",
	async () => {
		const a = await createAssignment();
		const r = await createReport(a);
		const status = await Promise.allSettled(
			["in_progress", "cancelled"].map((value) =>
				assignments.updateInspectionAssignment(
					db,
					f.workspace,
					f.inspector,
					a.id,
					{ requestId: randomUUID(), expectedRevision: 1, status: value },
				),
			),
		);
		assert.equal(
			status.filter((item) => item.status === "fulfilled").length,
			1,
		);
		assert.equal(
			status.find((item) => item.status === "rejected").reason.code,
			"REVISION_CONFLICT",
		);
		const corrections = await Promise.allSettled(
			["First", "Second"].map((notes) =>
				correct(r, {
					...reportBody(),
					expectedRevision: 1,
					reason: "Concurrent correction",
					notes,
				}),
			),
		);
		assert.equal(
			corrections.filter((item) => item.status === "fulfilled").length,
			1,
		);
		assert.equal(
			corrections.find((item) => item.status === "rejected").reason.code,
			"REVISION_CONFLICT",
		);
		assert.equal(await client.p1InspectionReportRevision.count(), 1);
		assert.equal(await client.inspectionAuditEvent.count(), 4);
	},
);

native(
	"PostgreSQL conflicting idempotency payloads create only one assignment",
	async () => {
		const requestId = randomUUID();
		const outcomes = await Promise.allSettled(
			[f.inspector, f.other].map((assigneeUserId) =>
				createAssignment({ requestId, assigneeUserId }),
			),
		);
		assert.equal(
			outcomes.filter((item) => item.status === "fulfilled").length,
			1,
		);
		assert.equal(
			outcomes.find((item) => item.status === "rejected").reason.code,
			"IDEMPOTENCY_CONFLICT",
		);
		assert.equal(await client.inspectionAuditEvent.count(), 1);
	},
);

native(
	"PostgreSQL pending transactions timestamp corrections after acquiring their locks",
	async () => {
		const a = await createAssignment();
		const r = await createReport(a);
		const lagged = {
			...db,
			transaction: (run) =>
				db.transaction(async (tx) => {
					await tx.query("SELECT CURRENT_TIMESTAMP AS started");
					await correct(r, {
						...reportBody(),
						expectedRevision: 1,
						reason: "First correction",
					});
					return run(tx);
				}),
		};
		const result = await correct(
			r,
			{ ...reportBody(), expectedRevision: 2, reason: "Queued correction" },
			lagged,
		);
		assert.equal(result.revision, 3);
	},
);

native(
	"PostgreSQL rejects unaudited changes, forged scope and changes to immutable history",
	async () => {
		const a = await createAssignment();
		const r = await createReport(a);
		await correct(r, {
			...reportBody(),
			expectedRevision: 1,
			reason: "Correction",
		});
		await assert.rejects(
			db.transaction((tx) =>
				tx.query(
					'UPDATE "InspectionAssignment" SET status=\'in_progress\',revision=revision+1,"updatedAt"=clock_timestamp() WHERE id=$1 RETURNING id',
					[a.id],
				),
			),
		);
		for (const table of [
			"P1InspectionReport",
			"P1InspectionReportRevision",
			"InspectionAuditEvent",
		]) {
			for (const command of [
				`UPDATE "${table}" SET "workspaceId"='foreign'`,
				`DELETE FROM "${table}"`,
				`TRUNCATE "${table}" CASCADE`,
			])
				await assert.rejects(client.$executeRawUnsafe(command));
		}
		await assert.rejects(
			client.$executeRawUnsafe(
				'UPDATE "InspectionAssignment" SET "locationId"=\'foreign\' WHERE id=$1',
				a.id,
			),
		);
		assert.equal(
			(await client.p1InspectionReport.findUnique({ where: { id: r.id } }))
				.notes,
			r.notes,
		);
		assert.equal(await client.p1InspectionReportRevision.count(), 1);
	},
);

native(
	"PostgreSQL audit insertion failure rolls back status, revision and idempotent receipt",
	async () => {
		const a = await createAssignment();
		const r = await createReport(a);
		const receipts = await client.researchRequest.count();
		await client.$executeRawUnsafe(
			`CREATE FUNCTION fail_inspection_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private-audit-sentinel'; END; $$`,
		);
		await client.$executeRawUnsafe(
			'CREATE TRIGGER fail_audit BEFORE INSERT ON "InspectionAuditEvent" FOR EACH ROW EXECUTE FUNCTION fail_inspection_audit()',
		);
		const body = {
			...reportBody(),
			expectedRevision: 1,
			reason: "Retryable correction",
		};
		await assert.rejects(correct(r, body));
		await assert.rejects(
			assignments.updateInspectionAssignment(
				db,
				f.workspace,
				f.inspector,
				a.id,
				{ requestId: randomUUID(), expectedRevision: 1, status: "in_progress" },
			),
		);
		assert.equal(await client.p1InspectionReportRevision.count(), 0);
		assert.equal(await client.researchRequest.count(), receipts);
		assert.equal(
			(await client.inspectionAssignment.findUnique({ where: { id: a.id } }))
				.revision,
			1,
		);
		await client.$executeRawUnsafe(
			'DROP TRIGGER fail_audit ON "InspectionAuditEvent"',
		);
		assert.equal((await correct(r, body)).revision, 2);
	},
);

native(
	"PostgreSQL composite references and audit guards reject fabricated evidence",
	async () => {
		const a = await createAssignment();
		const r = await createReport(a);
		await assert.rejects(
			client.$queryRawUnsafe(
				`INSERT INTO "P1InspectionReport"
		(id,"workspaceId","locationId","assignmentId","requestId","inspectorUserId",inspector,"observedAt",outcome,notes,"recordedById","recordedBy")
		SELECT $1,"workspaceId",'foreign-location',"assignmentId",$2::uuid,"inspectorUserId",inspector,"observedAt",outcome,notes,"recordedById","recordedBy"
		FROM "P1InspectionReport" WHERE id=$3 RETURNING id`,
				randomUUID(),
				randomUUID(),
				r.id,
			),
			(error) => error.meta?.code === "23503",
		);
		await assert.rejects(
			client.$queryRawUnsafe(
				`INSERT INTO "InspectionAuditEvent"
		(id,"workspaceId","locationId","assignmentId",action,"requestId","actorId",actor,"fromRevision","toRevision","fromStatus","toStatus")
		SELECT $1,"workspaceId","locationId",id,'assignment_status_changed',$2::uuid,"assignedById","assignedBy",1,2,'assigned','in_progress'
		FROM "InspectionAssignment" WHERE id=$3 RETURNING id`,
				randomUUID(),
				randomUUID(),
				a.id,
			),
			(error) => error.meta?.code === "23514",
		);
		assert.equal(await client.p1InspectionReport.count(), 1);
		assert.equal(await client.inspectionAuditEvent.count(), 2);
	},
);
