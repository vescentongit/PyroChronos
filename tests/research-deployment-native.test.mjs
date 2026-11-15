import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { operationalStatus } from "../src/lib/research-operational-status.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("separate migrate action is repeatable on dedicated native schema; status reads never migrate", {
	skip: !process.env.RESEARCH_TEST_DATABASE_URL,
}, async () => {
	const url = new URL(process.env.RESEARCH_TEST_DATABASE_URL);
	assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
	assert.equal(url.pathname, "/research_worker_test");
	const schema = `deployment_test_${randomUUID().replaceAll("-", "")}`;
	url.searchParams.set("schema", schema);
	const client = new PrismaClient({ datasourceUrl: url.href });
	const old = { ...process.env };
	const root = await mkdtemp(join(tmpdir(), "ready-native-"));
	try {
		await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
		Object.assign(process.env, {
			DATABASE_URL: url.href,
			RESEARCH_V2_EXPERIMENTAL: "true",
			AUTH_SECRET: "synthetic-auth-secret-only-for-tests-32",
			AUTH_GOOGLE_ID: "synthetic",
			AUTH_GOOGLE_SECRET: "synthetic",
			RESEARCH_DATA_DIR: root,
			RESEARCH_ARTIFACT_ROOT: root,
		});
		delete process.env.VERCEL;
		delete process.env.PIPELINE_URL;
		const { GET } = await import("../src/app/api/ready/route.ts");
		assert.equal(
			(await GET()).status,
			503,
			"Unmigrated database must not be ready",
		);
		for (let i = 0; i < 2; i++) {
			const run = spawnSync(process.execPath, ["scripts/deploy-migrate.mjs"], {
				env: {
					...process.env,
					DATABASE_URL: url.href,
					RESEARCH_DEPLOY_MIGRATIONS: "true",
				},
				encoding: "utf8",
				timeout: 90000,
			});
			assert.equal(run.status, 0, "Dedicated migration action failed");
			assert.equal(run.stdout.trim(), "MIGRATION_SUCCEEDED");
			assert.doesNotMatch(run.stderr, /postgresql|synthetic-local-test-only/);
		}
		const [before] = await client.$queryRawUnsafe(
			'SELECT count(*)::int AS count FROM "_prisma_migrations"',
		);
		const status = await operationalStatus({
			query: (q, p = []) => client.$queryRawUnsafe(q, ...p),
		});
		assert.deepEqual(status.jobs, []);
		assert.deepEqual(status.ingest, []);
		assert.equal(status.dataset, null);
		const [after] = await client.$queryRawUnsafe(
			'SELECT count(*)::int AS count FROM "_prisma_migrations"',
		);
		assert.deepEqual(after, before);
		assert.equal((await GET()).status, 200);
		const { getDb } = await import("../src/lib/db.ts");
		await getDb().$disconnect();
	} finally {
		await client.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
		await client.$disconnect();
		process.env = old;
		await rm(root, { recursive: true, force: true });
	}
});
