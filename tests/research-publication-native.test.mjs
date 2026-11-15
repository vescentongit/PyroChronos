import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, unlink, readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import {
	publicationFixture,
	seedPublication,
} from "./helpers/research-publication-fixtures.mjs";

const hook = registerHooks({
	resolve(specifier, context, next) {
		return next(
			context.parentURL?.includes("/src/lib/research-") &&
				specifier.startsWith("./") &&
				!specifier.endsWith(".ts")
				? `${specifier}.ts`
				: specifier,
			context,
		);
	},
});
let publishResearchResult,
	prismaPublicationDatabase,
	FileResearchArtifactStorage,
	observationReader;
try {
	({ publishResearchResult } = await import(
		"../src/lib/research-publication.ts"
	));
	({ prismaPublicationDatabase } = await import(
		"../src/lib/research-publication-db.ts"
	));
	({ FileResearchArtifactStorage } = await import(
		"../src/lib/research-publication-storage.ts"
	));
	observationReader = await import("../src/lib/research-observations.ts");
} finally {
	hook.deregister();
}

const dsn = process.env.RESEARCH_TEST_DATABASE_URL;
const native = (name, body) => test(name, { skip: !dsn }, body);
let client, schema, root, storage, database, request, fixture;
function setupSchema(operation) {
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
	assert.equal(run.status, 0, "Dedicated native test database setup failed");
}
beforeEach(async () => {
	if (!dsn) return;
	const url = new URL(dsn);
	assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
	assert.equal(url.pathname, "/research_worker_test");
	schema = `publication_test_${randomUUID().replaceAll("-", "")}`;
	setupSchema("init");
	url.searchParams.set("schema", schema);
	client = new PrismaClient({ datasourceUrl: url.href });
	database = prismaPublicationDatabase(client);
	root = await mkdtemp(path.join(tmpdir(), "publication-native-"));
	storage = new FileResearchArtifactStorage(root);
	({ request, fixture } = publicationFixture());
	fixture.attempt.leaseExpiresAt = new Date(Date.now() + 2000).toISOString();
	await seedPublication(database, fixture);
});
afterEach(async () => {
	if (!dsn) return;
	await client?.$disconnect();
	if (schema) setupSchema("drop");
	if (root) await rm(root, { recursive: true, force: true });
});

native(
	"Prisma transaction serializes concurrent publications and reuses the committed result",
	async () => {
		const dependency = { database, storage };
		const [first, second] = await Promise.all([
			publishResearchResult(dependency, request),
			publishResearchResult(dependency, request),
		]);
		assert.equal(first.resultId, second.resultId);
		assert.equal(Number(first.reused) + Number(second.reused), 1);
		assert.equal((await client.analysisResult.findMany()).length, 1);
		assert.equal(
			(await client.p1AnalysisJob.findUnique({ where: { id: fixture.job.id } }))
				.status,
			"succeeded",
		);
	},
);

native(
	"repeat reconciliation retains private orphans and restores only missing verified objects without changing history",
	async () => {
		const { loadInspectionModule } = await import(
			"./helpers/research-inspection-fixtures.mjs"
		);
		const { reconcileResearchObjects } =
			await loadInspectionModule("research-recovery");
		await publishResearchResult({ database, storage }, request);
		const backupRoot = await mkdtemp(path.join(tmpdir(), "recovery-backup-"));
		try {
			const backup = new FileResearchArtifactStorage(backupRoot);
			const artifacts = await client.p1AnalysisArtifact.findMany();
			for (const row of artifacts)
				await backup.put(
					row.objectKey,
					await storage.read(row.objectKey, row.checksum, Number(row.bytes)),
				);
			await storage.put(
				"research/uncommitted.json",
				Buffer.from("synthetic orphan"),
			);
			await unlink(path.join(root, artifacts[0].objectKey));
			const counts = await Promise.all([
				client.analysisResult.count(),
				client.analysisManifest.count(),
				client.p1AnalysisJobAttempt.count(),
				client.p1InspectionReport.count(),
			]);
			const first = await reconcileResearchObjects(database, root, backupRoot);
			assert.ok(first.some((row) => row.status === "restored"));
			const second = await reconcileResearchObjects(database, root, backupRoot);
			assert.deepEqual(
				await reconcileResearchObjects(database, root, backupRoot),
				second,
			);
			assert.ok(
				second.some(
					(row) =>
						row.key === "research/uncommitted.json" &&
						row.status === "unreferenced-retained",
				),
			);
			assert.equal(
				(
					await readFile(path.join(root, "research/uncommitted.json"))
				).toString(),
				"synthetic orphan",
			);
			assert.deepEqual(
				await Promise.all([
					client.analysisResult.count(),
					client.analysisManifest.count(),
					client.p1AnalysisJobAttempt.count(),
					client.p1InspectionReport.count(),
				]),
				counts,
			);
			await publishResearchResult({ database, storage }, request);
			assert.equal(await client.analysisResult.count(), 1);
		} finally {
			await rm(backupRoot, { recursive: true, force: true });
		}
	},
);

native(
	"killing a publisher inside its transaction rolls back result/manifest and a replay publishes once",
	async () => {
		await client.p1AnalysisJobAttempt.update({
			where: { id: fixture.attempt.id },
			data: { leaseExpiresAt: new Date(Date.now() + 30000) },
		});
		const url = new URL(dsn);
		url.searchParams.set("schema", schema);
		const child = spawn(
			process.execPath,
			["tests/helpers/research-publication-crash.mjs"],
			{
				env: {
					...process.env,
					DATABASE_URL: url.href,
					RESEARCH_ARTIFACT_ROOT: root,
				},
				stdio: ["pipe", "pipe", "ignore"],
				windowsHide: true,
			},
		);
		const exited = once(child, "exit");
		const lines = createInterface({ input: child.stdout });
		let timer;
		try {
			const barrier = Promise.race([
				once(lines, "line"),
				exited.then(() => {
					throw new Error("Publisher exited before transaction barrier");
				}),
				new Promise((_, reject) => {
					timer = setTimeout(
						() => reject(new Error("Publisher barrier timeout")),
						15000,
					);
				}),
			]);
			child.stdin.end(JSON.stringify(request));
			assert.equal((await barrier)[0], "inside-publication");
			assert.equal(
				await client.analysisResult.count(),
				0,
				"Uncommitted result became visible",
			);
			assert.equal(await client.analysisManifest.count(), 0);
			child.kill("SIGKILL");
			await exited;
			assert.equal(await client.analysisResult.count(), 0);
			assert.equal(await client.analysisManifest.count(), 0);
			assert.equal(await client.p1AnalysisArtifact.count(), 0);
			await publishResearchResult({ database, storage }, request);
			await publishResearchResult({ database, storage }, request);
			assert.equal(await client.analysisResult.count(), 1);
			assert.equal(await client.analysisManifest.count(), 1);
		} finally {
			clearTimeout(timer);
			lines.close();
			if (child.exitCode === null && child.signalCode === null) child.kill();
			await exited;
		}
	},
);

native(
	"a lease expiring inside the native publication transaction rolls back every write",
	async () => {
		let verifies = 0;
		const expiring = {
			put: (...args) => storage.put(...args),
			verify: async (...args) => {
				await storage.verify(...args);
				if (++verifies === request.artifacts.length + 1) {
					await new Promise((resolve) =>
						setTimeout(
							resolve,
							Math.max(
								0,
								Date.parse(fixture.attempt.leaseExpiresAt) - Date.now() + 50,
							),
						),
					);
				}
			},
		};
		await assert.rejects(
			() => publishResearchResult({ database, storage: expiring }, request),
			(e) => e.code === "LEASE_LOST",
		);
		assert.equal((await client.analysisResult.findMany()).length, 0);
		assert.equal((await client.analysisManifest.findMany()).length, 0);
		assert.equal(
			(
				await client.p1AnalysisJobAttempt.findUnique({
					where: { id: fixture.attempt.id },
				})
			).status,
			"running",
		);
	},
);

native(
	"PostgreSQL rejects empty publication and exposes rebound observations to P1 readers",
	async () => {
		await assert.rejects(
			() =>
				publishResearchResult(
					{ database, storage },
					{ ...request, artifacts: [] },
				),
			(error) => error.code === "INVALID_OUTPUT",
		);
		assert.equal(await client.analysisResult.count(), 0);
		const receipt = await publishResearchResult({ database, storage }, request);
		const sql = { query: database.query };
		const result = await observationReader.readPublishedAnalysis(
			sql,
			fixture.job.workspaceId,
			receipt.resultId,
		);
		const observations = [];
		for await (const observation of observationReader.iterateResearchObservations(
			sql,
			storage,
			result,
			{ periodRole: "primary" },
		))
			observations.push(observation);
		assert.equal(observations.length, result.primary.metric.rawCount);
		assert.deepEqual(
			observations.find((item) => item.id === fixture.location.anchor.id),
			fixture.location.anchor,
		);
	},
);
