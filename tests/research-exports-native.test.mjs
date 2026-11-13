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
	exportFixture,
	exportsService as api,
	exportWorker as worker,
	exportQueue as queue,
	assignments,
	reports,
	Storage,
} from "./helpers/research-export-fixtures.mjs";

const dsn = process.env.RESEARCH_TEST_DATABASE_URL;
const native = (name, run) => test(name, { skip: !dsn }, run);
let client, db, root, schema, storage, f;
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
	const run = spawnSync(
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
	assert.equal(run.status, 0, "Dedicated native export database setup failed");
}
beforeEach(async () => {
	if (!dsn) return;
	const url = new URL(dsn);
	assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
	assert.equal(url.pathname, "/research_worker_test");
	schema = `publication_test_${randomUUID().replaceAll("-", "")}`;
	setup("init");
	url.searchParams.set("schema", schema);
	client = new PrismaClient({ datasourceUrl: url.href });
	db = sql(client);
	root = await mkdtemp(path.join(tmpdir(), "exports-native-"));
	storage = new Storage(root);
	f = await exportFixture(db, storage);
});
afterEach(async () => {
	if (!dsn) return;
	await client?.$disconnect();
	if (schema) setup("drop");
	if (root) await rm(root, { recursive: true, force: true });
});
const body = (changes = {}) => ({
	requestId: randomUUID(),
	analysisId: f.analysisId,
	periodRole: "primary",
	kind: "raw-hotspots-csv",
	...changes,
});
const create = (input = body(), dependencies = f.dependencies) =>
	api.createResearchExport(dependencies, f.workspace, f.user, input);

native(
	"PostgreSQL export creation and worker claims are atomic under concurrency",
	async () => {
		const input = body();
		const receipts = await Promise.all(
			Array.from({ length: 6 }, () => create(input)),
		);
		assert.ok(receipts.every((r) => r.value.id === receipts[0].value.id));
		assert.equal(await client.researchExport.count(), 1);
		const claims = await Promise.all([
			queue.claimResearchExport(db),
			queue.claimResearchExport(db),
		]);
		assert.equal(claims.filter(Boolean).length, 1);
		assert.equal(await client.researchExportAttempt.count(), 1);
	},
);

native(
	"PostgreSQL expired lease cannot heartbeat and retry preserves previous attempts",
	async () => {
		const created = await create();
		const first = await queue.claimResearchExport(db, { leaseSeconds: 1 });
		await new Promise((resolve) => setTimeout(resolve, 1100));
		assert.equal(await queue.heartbeatResearchExport(db, first), false);
		const second = await queue.claimResearchExport(db);
		assert.equal(second.job.id, created.value.id);
		assert.equal(second.attempt.attemptNo, 2);
		assert.notEqual(second.attempt.leaseToken, first.attempt.leaseToken);
		assert.equal(
			(
				await client.researchExportAttempt.findUnique({
					where: { id: first.attempt.id },
				})
			).status,
			"expired",
		);
		assert.equal(await queue.heartbeatResearchExport(db, first), false);
		assert.equal(await queue.heartbeatResearchExport(db, second), true);
	},
);

native(
	"PostgreSQL failed export history does not block a new request or overwrite prior exports",
	async () => {
		const initial = await create(body({ kind: "harmonized-aggregates-csv" }));
		assert.equal(
			(await worker.runResearchExportOnce(f.dependencies)).status,
			"ready",
		);
		const failed = await create();
		await queue.claimResearchExport(db, { leaseSeconds: 1, maxAttempts: 1 });
		await new Promise((resolve) => setTimeout(resolve, 1100));
		assert.equal(await queue.claimResearchExport(db, { maxAttempts: 1 }), null);
		assert.equal(
			(
				await api.readResearchExport(
					f.dependencies,
					f.workspace,
					f.user,
					failed.value.id,
				)
			).status,
			"failed",
		);
		const retried = await create();
		assert.notEqual(retried.value.id, failed.value.id);
		assert.equal(
			(await worker.runResearchExportOnce(f.dependencies)).status,
			"ready",
		);
		assert.equal(
			(
				await api.readResearchExport(
					f.dependencies,
					f.workspace,
					f.user,
					initial.value.id,
				)
			).status,
			"ready",
		);
	},
);

native(
	"PostgreSQL publication rollback leaves no partial artifact metadata and can retry",
	async () => {
		const created = await create();
		await client.$executeRawUnsafe(
			`CREATE FUNCTION reject_export_manifest() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='manifest' THEN RAISE EXCEPTION 'private-db-sentinel'; END IF; RETURN NEW; END; $$`,
		);
		await client.$executeRawUnsafe(
			'CREATE TRIGGER reject_manifest BEFORE INSERT ON "ResearchExportArtifact" FOR EACH ROW EXECUTE FUNCTION reject_export_manifest()',
		);
		assert.equal(
			(await worker.runResearchExportOnce(f.dependencies)).status,
			"failed",
		);
		assert.equal(await client.researchExportArtifact.count(), 0);
		assert.equal(
			(
				await api.readResearchExport(
					f.dependencies,
					f.workspace,
					f.user,
					created.value.id,
				)
			).status,
			"queued",
		);
		await client.$executeRawUnsafe(
			'DROP TRIGGER reject_manifest ON "ResearchExportArtifact"',
		);
		assert.equal(
			(await worker.runResearchExportOnce(f.dependencies)).status,
			"ready",
		);
		assert.equal(await client.researchExportAttempt.count(), 2);
	},
);

native(
	"PostgreSQL inspection snapshot is consistent while a correction races export creation",
	async () => {
		const a = await assignments.createInspectionAssignment(
			db,
			f.workspace,
			f.user,
			f.location.id,
			{ requestId: randomUUID(), assigneeUserId: f.user },
		);
		const input = {
			requestId: randomUUID(),
			inspectorUserId: f.user,
			observedAt: "2026-08-01T00:00:00Z",
			outcome: "inconclusive",
			notes: "Before correction",
		};
		const report = await reports.createResearchReport(
			db,
			f.workspace,
			f.user,
			a.id,
			input,
		);
		const [created] = await Promise.all([
			create(),
			reports.correctResearchReport(db, f.workspace, f.user, report.id, {
				...input,
				requestId: randomUUID(),
				expectedRevision: 1,
				reason: "Correction",
				notes: "After correction",
			}),
		]);
		await worker.runResearchExportOnce(f.dependencies);
		const manifest = await api.getResearchExportManifest(
			f.dependencies,
			f.workspace,
			f.user,
			created.value.id,
		);
		const snapshot = manifest.inspectionContext.reports[0];
		assert.ok([1, 2].includes(snapshot.revision));
		assert.equal(
			snapshot.notes,
			snapshot.revision === 1 ? "Before correction" : "After correction",
		);
		assert.equal(snapshot.corrections.length, snapshot.revision - 1);
		const latest = await create();
		await worker.runResearchExportOnce(f.dependencies);
		assert.equal(
			(
				await api.getResearchExportManifest(
					f.dependencies,
					f.workspace,
					f.user,
					latest.value.id,
				)
			).inspectionContext.reports[0].revision,
			2,
		);
	},
);

native(
	"PostgreSQL lease expiry during final verification rolls back every publication write",
	async () => {
		const created = await create();
		let delayed = false;
		const expiringStorage = {
			put: (...args) => storage.put(...args),
			putStream: (...args) => storage.putStream(...args),
			read: (...args) => storage.read(...args),
			verify: async (...args) => {
				await storage.verify(...args);
				if (!delayed) {
					delayed = true;
					await new Promise((resolve) => setTimeout(resolve, 750));
				}
			},
		};
		assert.equal(
			(
				await worker.runResearchExportOnce({
					...f.dependencies,
					storage: expiringStorage,
					policy: { leaseSeconds: 0.5 },
				})
			).status,
			"lease_lost",
		);
		assert.equal(await client.researchExportArtifact.count(), 0);
		assert.notEqual(
			(
				await api.readResearchExport(
					f.dependencies,
					f.workspace,
					f.user,
					created.value.id,
				)
			).status,
			"ready",
		);
	},
);

native(
	"PostgreSQL export inputs, snapshots, attempts and ready artifacts cannot be rewritten",
	async () => {
		const created = await create();
		await worker.runResearchExportOnce(f.dependencies);
		for (const statement of [
			'UPDATE "ResearchExport" SET "inspectionSnapshot"=\'{}\'::jsonb',
			'UPDATE "ResearchExportArtifact" SET "workspaceId"=\'foreign\'',
			'UPDATE "ResearchExportAttempt" SET "leaseToken"=\'11111111-1111-4111-8111-111111111111\'::uuid',
			'DELETE FROM "ResearchExport"',
			'TRUNCATE "ResearchExportArtifact" CASCADE',
		])
			await assert.rejects(client.$executeRawUnsafe(statement));
		assert.equal(
			(
				await api.readResearchExport(
					f.dependencies,
					f.workspace,
					f.user,
					created.value.id,
				)
			).status,
			"ready",
		);
	},
);
