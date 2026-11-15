// Run after npm run build, against a disposable localhost test database only.
// Exercises the built Next server over HTTP; never deploys to a provider.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";

async function verify() {
	const url = new URL(process.env.RESEARCH_TEST_DATABASE_URL);
	assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
	assert.equal(url.pathname, "/research_worker_test");
	const schema = `handoff_test_${randomUUID().replaceAll("-", "")}`;
	url.searchParams.set("schema", schema);
	const client = new PrismaClient({ datasourceUrl: url.href });
	const root = await mkdtemp(join(tmpdir(), "staging-handoff-"));
	const env = {
		...process.env,
		NODE_ENV: "production",
		NEXT_TELEMETRY_DISABLED: "1",
		DATABASE_URL: url.href,
		AUTH_SECRET: "synthetic-handoff-auth-secret-only-32",
		AUTH_GOOGLE_ID: "synthetic-handoff-google-id",
		AUTH_GOOGLE_SECRET: "synthetic-handoff-google-secret",
		AUTH_TRUST_HOST: "true",
		RESEARCH_V2_EXPERIMENTAL: "true",
		RESEARCH_DATA_DIR: join(root, "data"),
		RESEARCH_ARTIFACT_ROOT: join(root, "artifacts"),
		RESEARCH_DEPLOY_MIGRATIONS: "false",
		PIPELINE_URL: "",
		VERCEL: "",
		FIRMS_BLOB_BASE_URL: "",
		BLOB_READ_WRITE_TOKEN: "",
		FIRMS_MAP_KEY: "",
	};
	const privateValues = [
		url.href,
		url.password,
		env.AUTH_SECRET,
		env.AUTH_GOOGLE_SECRET,
	];
	const safe = (value) => {
		for (const secret of privateValues) assert.ok(!value.includes(secret));
	};
	const command = (script, args = [], extra = {}, expected = 0) => {
		const result = spawnSync(process.execPath, [script, ...args], {
			env: { ...env, ...extra },
			encoding: "utf8",
			timeout: 90000,
		});
		safe(result.stdout || "");
		safe(result.stderr || "");
		assert.equal(result.status, expected, `Failed action: ${script}`);
		return (result.stdout || result.stderr).trim();
	};
	let server;
	let serverClosed;
	let logs = "";
	try {
		await mkdir(env.RESEARCH_DATA_DIR);
		await mkdir(env.RESEARCH_ARTIFACT_ROOT);
		await client.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
		for (const role of [
			"app",
			"migration",
			"worker",
			"export-worker",
			"pipeline",
		])
			assert.equal(
				JSON.parse(command("scripts/check-runtime.mjs", [role])).ok,
				true,
			);
		assert.equal(
			command("scripts/deploy-migrate.mjs", [], {}, 1),
			"MIGRATION_CONFIG_INVALID",
		);
		const reservation = createServer();
		reservation.listen(0, "127.0.0.1");
		await once(reservation, "listening");
		const port = reservation.address().port;
		await new Promise((resolve, reject) =>
			reservation.close((e) => (e ? reject(e) : resolve())),
		);
		server = spawn(
			process.execPath,
			[
				"node_modules/next/dist/bin/next",
				"start",
				"--hostname",
				"127.0.0.1",
				"--port",
				String(port),
			],
			{
				env,
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
			},
		);
		server.stdout.on("data", (data) => {
			logs += data;
		});
		server.stderr.on("data", (data) => {
			logs += data;
		});
		serverClosed = once(server, "close");
		const request = async (path, options) => {
			const response = await fetch(`http://127.0.0.1:${port}${path}`, {
				...options,
				signal: AbortSignal.timeout(10000),
			});
			const body = await response.text();
			safe(body);
			return { response, body: JSON.parse(body) };
		};
		let started = false;
		for (let attempt = 0; attempt < 80; attempt++) {
			try {
				const health = await request("/api/health");
				assert.equal(health.response.status, 200);
				assert.deepEqual(health.body, { status: "ok" });
				assert.equal(health.response.headers.get("cache-control"), "no-store");
				started = true;
				break;
			} catch {
				await delay(250);
			}
		}
		assert.ok(started, "Built Next server did not become live");
		const before = await request("/api/ready");
		assert.equal(before.response.status, 503);
		assert.deepEqual(before.body, { status: "not_ready" });
		for (let i = 0; i < 2; i++)
			assert.equal(
				command("scripts/deploy-migrate.mjs", [], {
					RESEARCH_DEPLOY_MIGRATIONS: "true",
				}),
				"MIGRATION_SUCCEEDED",
			);
		const migrationCount = async () =>
			(
				await client.$queryRawUnsafe(
					'SELECT count(*)::int AS count FROM "_prisma_migrations"',
				)
			)[0].count;
		const countBefore = await migrationCount();
		const status = JSON.parse(command("scripts/research-status.mjs"));
		assert.equal(status.scope, "operator-global-not-workspace-api");
		assert.deepEqual(status.jobs, []);
		assert.deepEqual(status.ingest, []);
		assert.deepEqual(status.exports, []);
		assert.equal(status.dataset, null);
		for (const key of ["N1", "N2", "N3", "N4"])
			assert.ok(status.qualityLimitations[key]);
		for (let i = 0; i < 3; i++) {
			const ready = await request("/api/ready");
			assert.equal(ready.response.status, 200);
			assert.deepEqual(ready.body, { status: "ready" });
			assert.equal(ready.response.headers.get("cache-control"), "no-store");
		}
		const geometry = {
			type: "Polygon",
			coordinates: [
				[
					[113, -3],
					[114, -3],
					[114, -2],
					[113, -2],
					[113, -3],
				],
			],
		};
		const area = await request("/api/local-research", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				action: "area",
				workspaceId: "local",
				area: { requestId: randomUUID(), name: "Synthetic staging", geometry },
			}),
		});
		assert.equal(
			area.response.status,
			200,
			"Anonymous path must remain available without login",
		);
		assert.deepEqual(area.body.geometry, geometry);
		const large = await request("/api/local-research", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ padding: "x".repeat(100001) }),
		});
		assert.equal(large.response.status, 413);
		assert.equal(large.body.code, "PAYLOAD_TOO_LARGE");
		assert.equal(large.response.headers.get("retry-after"), null);
		assert.equal(await migrationCount(), countBefore);
		// Simulate storage dependency loss while the process and database remain live.
		await rm(env.RESEARCH_DATA_DIR, { recursive: true });
		assert.equal((await request("/api/ready")).response.status, 503);
		assert.equal((await request("/api/health")).response.status, 200);
		await mkdir(env.RESEARCH_DATA_DIR);
		assert.equal((await request("/api/ready")).response.status, 200);
		const report = {
			schemaVersion: "staging-handoff-1",
			measuredAt: new Date().toISOString(),
			environment:
				"local built Next.js HTTP + disposable PostgreSQL; synthetic configuration, empty dataset",
			deployChecks: ["app", "migration", "worker", "export-worker", "pipeline"],
			migrationOptInRequired: true,
			separateMigrationRuns: 2,
			migrationRows: countBefore,
			health: 200,
			readyBeforeMigration: 503,
			readyAfterMigration: 200,
			readyWithMissingStorage: 503,
			healthWithMissingStorage: 200,
			readyAfterRestore: 200,
			status: {
				ingest: [],
				jobs: [],
				exports: [],
				dataset: null,
				qualityNotes: ["N1", "N2", "N3", "N4"],
			},
			anonymousAreaWithoutLogin: 200,
			polygonPreserved: true,
			oversizedPayload: 413,
			requestMigrationCountUnchanged: true,
			syntheticSecretsAbsentFromCapturedLogsAndResponses: true,
			limitations: [
				"No cloud rollout, real ingest/model validation, authenticated browser O4 or human review",
				"B1 concurrency/quota, B2 recovery and B3 access control are covered by separate full regression suites",
			],
		};
		return report;
	} finally {
		try {
			if (server && server.exitCode === null) {
				server.kill();
			}
			await serverClosed;
		} finally {
			try {
				await client.$executeRawUnsafe(
					`DROP SCHEMA IF EXISTS "${schema}" CASCADE`,
				);
			} finally {
				try {
					await client.$disconnect();
				} finally {
					await rm(root, { recursive: true, force: true });
				}
			}
		}
		safe(logs);
	}
}

try {
	const report = await verify();
	const output = process.argv[2];
	if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
	console.log(JSON.stringify(report));
} catch {
	console.error("STAGING_HANDOFF_VERIFICATION_FAILED");
	process.exitCode = 1;
}
