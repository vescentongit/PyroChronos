// Real PostgreSQL engine, synthetic private workspace; guarded localhost database only.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readdir, stat, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { registerHooks } from "node:module";
import { PrismaClient } from "@prisma/client";

const url = new URL(process.env.RESEARCH_TEST_DATABASE_URL);
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
assert.equal(url.pathname, "/research_worker_test");
registerHooks({
	resolve(specifier, context, next) {
		return next(
			context.parentURL?.includes("/src/lib/") &&
				specifier.startsWith("./") &&
				!/\.[a-z]+$/i.test(specifier)
				? `${specifier}.ts`
				: specifier,
			context,
		);
	},
});
const store = await import("../src/lib/research-store.ts");
const reads = await import("../src/lib/research-analyses.ts");
const schema = `publication_test_${randomUUID().replaceAll("-", "")}`;
const root = await mkdtemp(join(tmpdir(), "pyro-native-capacity-"));
const python =
	process.env.RESEARCH_PYTHON ||
	resolve(".cache/ingest-venv/Scripts/python.exe");
url.searchParams.set("schema", schema);
const env = {
	...process.env,
	PUBLICATION_TEST_SCHEMA: schema,
	DATABASE_URL: url.href,
	PYTHON: python,
	RESEARCH_PYTHON: python,
	RESEARCH_DATA_DIR: join(root, "store"),
	RESEARCH_MODELS_DIR: join(root, "models"),
	RESEARCH_ARTIFACT_ROOT: join(root, "artifacts"),
	RESEARCH_PRODUCER_MODE: "demo",
};
const command = (exe, args) => {
	const result = spawnSync(exe, args, {
		env,
		encoding: "utf8",
		timeout: 300_000,
		windowsHide: true,
	});
	// Do not print driver stderr, which could include credentialed URLs.
	assert.equal(result.status, 0, `Benchmark command failed: ${args[0]}`);
	return result.stdout.trim();
};
let client;
const rows = [];
const timed = async (name, fn) => {
	const start = performance.now();
	const result = await fn();
	rows.push({ name, elapsedMs: performance.now() - start });
	return result;
};
try {
	command(python, ["tests/helpers/research-publication-postgres.py", "init"]);
	command(python, ["scripts/benchmark-research-capacity.py", "fixture", root]);
	await mkdir(env.RESEARCH_MODELS_DIR);
	client = new PrismaClient({ datasourceUrl: url.href });
	const sql = (connection) => ({
		query: (q, params = []) => connection.$queryRawUnsafe(q, ...params),
		transaction: (fn) =>
			connection.$transaction((tx) => fn(sql(tx)), {
				maxWait: 10000,
				timeout: 20000,
			}),
	});
	const db = sql(client);
	await db.query(
		"INSERT INTO \"User\" (id,name) VALUES ('bench-user','Synthetic benchmark')",
	);
	for (const workspace of ["bench", "quota"]) {
		await db.query(
			'INSERT INTO "Workspace" (id,name,"createdById") VALUES ($1,$1,\'bench-user\')',
			[workspace],
		);
		await db.query(
			'INSERT INTO "Membership" ("workspaceId","userId",role) VALUES ($1,\'bench-user\',\'owner\')',
			[workspace],
		);
	}
	command(process.execPath, ["scripts/research-worker.mjs", "--register"]);
	let oldId, selectedArea, selectedRequest;
	for (const [size, west, south, east, north] of [
		["small", 113.9, -2.5, 114.2, -2.2],
		["large", 110, -5, 120, 0],
	]) {
		const geometry = {
			type: "Polygon",
			coordinates: [
				[
					[west, south],
					[east, south],
					[east, north],
					[west, north],
					[west, south],
				],
			],
		};
		const area = await store.createArea(db, "bench", {
			name: `Synthetic ${size}`,
			geometry,
		});
		assert.deepEqual(area.geometry, geometry);
		for (const [duration, start, end] of [
			["short", "2019-09-01", "2019-09-30"],
			["long", "2019-01-01", "2019-12-31"],
		]) {
			const body = {
				requestId: randomUUID(),
				areaId: area.id,
				areaRevision: 1,
				period: { start, end },
				comparisonPeriod: null,
				baseline: { kind: "rolling-same-calendar-period", windowYears: 10 },
				referenceScale: "MODIS-equivalent",
				qualityPolicyVersion: "quality-policy-1",
				monitoringLocationId: null,
			};
			const job = await timed(`submit/${size}/${duration}/miss`, () =>
				store.submitAnalysis(db, "bench", "bench-user", body),
			);
			const worker = await timed(`worker/${size}/${duration}`, () =>
				JSON.parse(
					command(process.execPath, ["scripts/research-worker.mjs", "--once"]),
				),
			);
			assert.equal(worker.status, "succeeded");
			const completed = await reads.readResearchJob(
				db,
				"bench",
				"bench-user",
				job.value.id,
			);
			const result = await reads.readResearchAnalysis(
				db,
				"bench",
				"bench-user",
				completed.resultId,
			);
			assert.deepEqual(result.area.geometry, geometry);
			for (let repeat = 0; repeat < 3; repeat++) {
				const hit = await timed(`submit/${size}/${duration}/hit`, () =>
					store.submitAnalysis(db, "bench", "bench-user", {
						...body,
						requestId: randomUUID(),
					}),
				);
				assert.equal(hit.value.id, job.value.id);
			}
			oldId = completed.resultId;
			selectedArea = area;
			selectedRequest = body;
		}
	}
	const statuses = await timed("queue/concurrency-6/quota-5", async () =>
		Promise.all(
			Array.from({ length: 6 }, async (_, i) => {
				try {
					await store.submitAnalysis(db, "bench", "bench-user", {
						...selectedRequest,
						requestId: randomUUID(),
						period: { start: "2019-01-01", end: `2019-01-${10 + i}` },
					});
					return "accepted";
				} catch (error) {
					assert.equal(error.code, "CAPACITY_LIMIT");
					return error.code;
				}
			}),
		),
	);
	assert.equal(statuses.filter((s) => s === "accepted").length, 5);
	assert.equal(statuses.filter((s) => s === "CAPACITY_LIMIT").length, 1);
	await timed("read/old-result/queue-full", () =>
		reads.readResearchAnalysis(db, "bench", "bench-user", oldId),
	);
	const cached = await timed("submit/succeeded-hit/queue-full", () =>
		store.submitAnalysis(db, "bench", "bench-user", {
			...selectedRequest,
			requestId: randomUUID(),
		}),
	);
	assert.equal(cached.value.resultId, oldId);
	// Separate scope so the fixed-window receipt quota isn't polluted by matrix setup.
	const quotaArea = await store.createArea(db, "quota", {
		name: "Synthetic quota",
		geometry: selectedArea.geometry,
	});
	let quotaStatus;
	await timed("receipts/quota-30", async () => {
		for (let i = 0; i < 31; i++) {
			try {
				await store.submitAnalysis(db, "quota", "bench-user", {
					...selectedRequest,
					requestId: randomUUID(),
					areaId: quotaArea.id,
				});
				assert.ok(i < 30);
			} catch (error) {
				assert.equal(i, 30);
				assert.equal(error.code, "RATE_LIMITED");
				quotaStatus = error.code;
			}
		}
	});
	assert.equal(quotaStatus, "RATE_LIMITED");
	const [relations] = await db.query(
		"SELECT sum(pg_total_relation_size(quote_ident(schemaname)||'.'||quote_ident(tablename)))::text AS bytes FROM pg_tables WHERE schemaname=current_schema()",
	);
	let artifactBytes = 0;
	async function walk(dir) {
		for (const item of await readdir(dir, { withFileTypes: true })) {
			const file = join(dir, item.name);
			if (item.isDirectory()) await walk(file);
			else artifactBytes += (await stat(file)).size;
		}
	}
	await walk(env.RESEARCH_ARTIFACT_ROOT);
	const [version] = await db.query("SELECT version() AS version");
	const report = {
		schemaVersion: "native-capacity-benchmark-1",
		measuredAt: new Date().toISOString(),
		synthetic: true,
		engine: version.version,
		methodology:
			"Real shipped migrations, submit service, worker CLI and publisher; raw synthetic model-less bundles. Wall includes process startup. DB relation bytes include indexes and empty migrated tables; not physical IO. No DB/worker CPU or RSS claimed.",
		statuses,
		quotaStatus,
		oldResultReadable: true,
		cachedResultReadableAtCapacity: true,
		relationBytes: Number(relations.bytes),
		artifactBytes,
		rows,
	};
	await mkdir("docs/benchmarks", { recursive: true });
	await writeFile(
		"docs/benchmarks/bagas-sprint-3-native.json",
		`${JSON.stringify(report, null, 2)}\n`,
	);
	console.log(
		JSON.stringify({
			rows: rows.length,
			relationBytes: report.relationBytes,
			artifactBytes,
			statuses,
			quotaStatus,
		}),
	);
} finally {
	await client?.$disconnect();
	command(python, ["tests/helpers/research-publication-postgres.py", "drop"]);
	await rm(root, { recursive: true, force: true });
}
