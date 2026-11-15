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
	locations,
	publishedFixture,
	Storage,
} from "./helpers/monitoring-location-fixtures.mjs";

const dsn = process.env.RESEARCH_TEST_DATABASE_URL;
const native = (name, run) => test(name, { skip: !dsn }, run);
let client, schema, root, database, storage, evidence, dependencies;
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
		"Dedicated native location database setup failed",
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
	database = sql(client);
	root = await mkdtemp(path.join(tmpdir(), "locations-native-"));
	storage = new Storage(root);
	evidence = await publishedFixture(database, storage);
	dependencies = { database, artifacts: storage };
});
afterEach(async () => {
	if (!dsn) return;
	await client?.$disconnect();
	if (schema) setup("drop");
	if (root) await rm(root, { recursive: true, force: true });
});
const create = (body = evidence.body) =>
	locations.createMonitoringLocation(
		dependencies,
		evidence.workspace,
		evidence.user,
		body,
	);

native(
	"PostgreSQL concurrent retries create exactly one immutable location and initial link",
	async () => {
		const results = await Promise.all(
			Array.from({ length: 8 }, () => create()),
		);
		for (const result of results) assert.deepEqual(result, results[0]);
		assert.equal(await client.monitoringLocation.count(), 1);
		assert.equal(await client.monitoringLocationAnalysis.count(), 1);
		assert.equal(await client.researchRequest.count(), 1);
		assert.equal(await client.analysisJob.count(), 0);
		assert.equal(await client.analysisResult.count(), 1);
	},
);

native(
	"PostgreSQL concurrent conflicting payloads have one winner and one 409 conflict",
	async () => {
		const outcomes = await Promise.allSettled([
			create(),
			create({ ...evidence.body, name: "Conflicting retry" }),
		]);
		assert.equal(
			outcomes.filter((outcome) => outcome.status === "fulfilled").length,
			1,
		);
		const failure = outcomes.find((outcome) => outcome.status === "rejected");
		assert.equal(failure.reason.code, "IDEMPOTENCY_CONFLICT");
		assert.equal(await client.monitoringLocation.count(), 1);
		assert.equal(await client.monitoringLocationAnalysis.count(), 1);
	},
);

native(
	"PostgreSQL later analysis links preserve anchor, creator, initial result and AOI",
	async () => {
		const initial = await create();
		const later = await publishedFixture(database, storage);
		await Promise.all(
			Array.from({ length: 4 }, () =>
				locations.linkMonitoringLocationAnalysis(
					dependencies,
					evidence.workspace,
					evidence.user,
					initial.id,
					later.analysisId,
				),
			),
		);
		assert.equal(await client.monitoringLocationAnalysis.count(), 2);
		for (const statement of [
			"UPDATE \"MonitoringLocation\" SET anchor='{}'::jsonb WHERE id=$1",
			'UPDATE "MonitoringLocation" SET "initialAnalysisId"=\'replacement\' WHERE id=$1',
			'UPDATE "MonitoringLocation" SET "areaRevision"=2 WHERE id=$1',
			'UPDATE "MonitoringLocation" SET "createdById"=\'replacement\' WHERE id=$1',
			'DELETE FROM "MonitoringLocation" WHERE id=$1',
			'DELETE FROM "MonitoringLocationAnalysis" WHERE "locationId"=$1',
		])
			await assert.rejects(client.$executeRawUnsafe(statement, initial.id));
		assert.deepEqual(
			await locations.getMonitoringLocation(
				dependencies,
				evidence.workspace,
				evidence.user,
				initial.id,
			),
			initial,
		);
	},
);

native(
	"PostgreSQL initial-link failure rolls back location and idempotency together",
	async () => {
		await client.$executeRawUnsafe(
			`CREATE FUNCTION reject_location_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private-database-sentinel'; END; $$`,
		);
		await client.$executeRawUnsafe(
			'CREATE TRIGGER reject_link BEFORE INSERT ON "MonitoringLocationAnalysis" FOR EACH ROW EXECUTE FUNCTION reject_location_link()',
		);
		await assert.rejects(create());
		assert.equal(await client.monitoringLocation.count(), 0);
		assert.equal(await client.monitoringLocationAnalysis.count(), 0);
		assert.equal(await client.researchRequest.count(), 0);
		await client.$executeRawUnsafe(
			'DROP TRIGGER reject_link ON "MonitoringLocationAnalysis"',
		);
		assert.ok((await create()).id);
	},
);

native(
	"PostgreSQL membership revocation also blocks a previously successful retry",
	async () => {
		await create();
		await database.query(
			'UPDATE "Membership" SET active=false WHERE "workspaceId"=$1 AND "userId"=$2',
			[evidence.workspace, evidence.user],
		);
		await assert.rejects(create(), (error) => error.code === "FORBIDDEN");
		assert.equal(await client.monitoringLocation.count(), 1);
	},
);
