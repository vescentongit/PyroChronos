import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	readiness,
	safeOperationalEvent,
	validateRuntime,
} from "../src/lib/research-deployment.ts";
import { operationalStatus } from "../src/lib/research-operational-status.ts";

test("runtime checks are role-aware and never include synthetic credentials", () => {
	for (const role of ["app", "pipeline"]) {
		assert.equal(
			validateRuntime({ FIRMS_MAP_KEY: "synthetic-on-demand-key" }, role).ok,
			true,
		);
	}
	assert.equal(
		validateRuntime({ RESEARCH_DATA_DIR: "/synthetic/store" }, "app").ok,
		true,
	);
	const bad = validateRuntime(
		{
			DATABASE_URL: "postgresql://synthetic:private-sentinel@host/db",
			RESEARCH_V2_EXPERIMENTAL: "true",
			NEXT_PUBLIC_API_TOKEN: "private-sentinel",
		},
		"app",
	);
	assert.equal(bad.ok, false);
	assert.doesNotMatch(JSON.stringify(bad), /private-sentinel|postgresql/);
	assert.equal(
		validateRuntime(
			{
				DATABASE_URL: "postgresql://synthetic:private-sentinel@localhost/test",
			},
			"migration",
		).ok,
		true,
	);
});

test("local on-demand readiness checks configuration without requesting NASA or exposing its key", async () => {
	const { GET } = await import("../src/app/api/ready/route.ts");
	const old = { ...process.env };
	try {
		for (const key of [
			"VERCEL",
			"PIPELINE_URL",
			"RESEARCH_DATA_DIR",
			"RESEARCH_V2_EXPERIMENTAL",
		])
			delete process.env[key];
		process.env.FIRMS_MAP_KEY = "synthetic-on-demand-key";
		const result = await GET();
		assert.equal(result.status, 200);
		assert.deepEqual(await result.json(), { status: "ready" });
	} finally {
		process.env = old;
	}
});

test("liveness and readiness HTTP expose no internal configuration or errors", async () => {
	const { GET: live } = await import("../src/app/api/health/route.ts");
	const { GET: ready } = await import("../src/app/api/ready/route.ts");
	assert.deepEqual(await live().json(), { status: "ok" });
	const old = { ...process.env };
	const root = await mkdtemp(join(tmpdir(), "ready-fixture-"));
	try {
		delete process.env.VERCEL;
		delete process.env.PIPELINE_URL;
		delete process.env.RESEARCH_V2_EXPERIMENTAL;
		process.env.RESEARCH_DATA_DIR = root;
		assert.equal((await ready()).status, 503);
		await mkdir(join(root, "MODIS_SP"));
		await writeFile(join(root, "MODIS_SP", "manifest.jsonl"), '{"detections_format":"pcd1","year":2019}\n');
		assert.equal((await ready()).status, 200);
		process.env.RESEARCH_DATA_DIR = join(root, "missing-private-sentinel");
		const failure = await ready();
		assert.equal(failure.status, 503);
		assert.equal(failure.headers.get("cache-control"), "no-store");
		assert.deepEqual(await failure.json(), { status: "not_ready" });
	} finally {
		process.env = old;
		await rm(root, { recursive: true, force: true });
	}
});

test("operator status projects counts/provenance with scientific caveats, never raw DB fields", async () => {
	const db = {
		query: async (sql) =>
			sql.includes("ResearchDataset")
				? [
						{
							config: {
								fingerprint: `sha256:${"a".repeat(64)}`,
								sources: ["MODIS_SP", "private-sentinel"],
								mode: "research",
								token: "private-sentinel",
							},
						},
					]
				: [
						{
							sourceId: "MODIS_SP",
							status: "FAILED",
							count: 1,
							payloadRef: "private-sentinel",
							error: "postgresql://private-sentinel",
						},
					],
	};
	const status = await operationalStatus(db);
	assert.equal(status.ingest[0].status, "FAILED");
	assert.deepEqual(status.dataset.sources, ["MODIS_SP"]);
	assert.match(status.qualityLimitations.N3, /null/);
	assert.doesNotMatch(JSON.stringify(status), /private-sentinel|postgresql/);
});

test("deploy CLI rejects invalid config and migration errors without echoing credentials", () => {
	for (const [script, extra] of [
		[
			"scripts/check-runtime.mjs",
			{ NEXT_PUBLIC_API_TOKEN: "private-sentinel" },
		],
		[
			"scripts/deploy-migrate.mjs",
			{ DATABASE_URL: "invalid-private-sentinel" },
		],
	]) {
		const run = spawnSync(process.execPath, [script], {
			env: { ...process.env, ...extra },
			encoding: "utf8",
		});
		assert.equal(run.status, 1);
		assert.doesNotMatch(run.stdout + run.stderr, /private-sentinel/);
	}
});
test("readiness fails closed and telemetry discards exception and credential fields", async () => {
	const response = await readiness(
		{ RESEARCH_DATA_DIR: "/synthetic" },
		async () => {
			throw new Error("postgresql://user:private-sentinel@host/db");
		},
	);
	assert.equal(response.status, "not_ready");
	assert.doesNotMatch(JSON.stringify(response), /sentinel|postgresql/);
	assert.deepEqual(
		safeOperationalEvent("ready", {
			error: "private-sentinel",
			token: "private-sentinel",
		}),
		{ event: "ready" },
	);
});
test("HTTP runtime has no migration runner and migration is a separate package action", async () => {
	async function check(dir) {
		for (const entry of await readdir(dir, { withFileTypes: true })) {
			const p = join(dir, entry.name);
			if (entry.isDirectory()) await check(p);
			else if (entry.name.endsWith(".ts"))
				assert.doesNotMatch(
					await readFile(p, "utf8"),
					/migrate\s+(deploy|dev|reset)|deploy-migrate/,
				);
		}
	}
	await check("src");
	const pkg = JSON.parse(await readFile("package.json", "utf8"));
	assert.match(pkg.scripts["deploy:migrate"], /deploy-migrate/);
	assert.doesNotMatch(pkg.scripts.build, /migrate/);
});
