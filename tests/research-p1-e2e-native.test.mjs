import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
	loadInspectionModule,
	assignments,
	reports,
} from "./helpers/research-inspection-fixtures.mjs";
const store = await loadInspectionModule("research-store");
const reads = await loadInspectionModule("research-analyses");
const observations = await loadInspectionModule("research-observations");
const locations = await loadInspectionModule("monitoring-locations");
const exportsService = await loadInspectionModule("research-exports");
const exportWorker = await loadInspectionModule("research-export-worker");
const { createResearchAnalysisHandlers } = await loadInspectionModule(
	"research-analyses-http",
);
const consumer = await loadInspectionModule("research-client");
const { FileResearchArtifactStorage } = await loadInspectionModule(
	"research-publication-storage",
);
const native = (name, run) =>
	test(name, { skip: !process.env.RESEARCH_TEST_DATABASE_URL }, run);
const python = process.env.PYTHON || "python";
let client, db, schema, root, env, storage, area;
const sql = (connection) => ({
	query: (query, params = []) => connection.$queryRawUnsafe(query, ...params),
	transaction: (run) =>
		connection.$transaction((tx) => run(sql(tx)), {
			maxWait: 10000,
			timeout: 20000,
		}),
});
const command = (binary, args, options = {}) => {
	const result = spawnSync(binary, args, {
		env,
		encoding: "utf8",
		timeout: 30000,
		...options,
	});
	assert.equal(
		result.status,
		0,
		`Synthetic E2E command failed: ${JSON.stringify(result.stdout)} ${JSON.stringify(result.stderr)}`,
	);
	return result.stdout;
};
function setup(action) {
	command(python, ["tests/helpers/research-publication-postgres.py", action], {
		env: { ...process.env, PUBLICATION_TEST_SCHEMA: schema },
	});
}
beforeEach(async () => {
	if (!process.env.RESEARCH_TEST_DATABASE_URL) return;
	const url = new URL(process.env.RESEARCH_TEST_DATABASE_URL);
	assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname));
	assert.equal(url.pathname, "/research_worker_test");
	schema = `publication_test_${randomUUID().replaceAll("-", "")}`;
	setup("init");
	url.searchParams.set("schema", schema);
	client = new PrismaClient({ datasourceUrl: url.href });
	db = sql(client);
	root = await mkdtemp(path.join(tmpdir(), "p1-e2e-"));
	env = {
		...process.env,
		DATABASE_URL: url.href,
		PYTHON: python,
		RESEARCH_PYTHON: python,
		RESEARCH_DATA_DIR: path.join(root, "store"),
		RESEARCH_MODELS_DIR: path.join(root, "models"),
		RESEARCH_ARTIFACT_ROOT: path.join(root, "artifacts"),
		RESEARCH_PRODUCER_MODE: "demo",
	};
	command(python, ["tests/helpers/research-e2e-fixture.py", root]);
	storage = new FileResearchArtifactStorage(env.RESEARCH_ARTIFACT_ROOT);
	await db.query(
		"INSERT INTO \"User\" (id,name) VALUES ('e2e-user','Synthetic investigator')",
	);
	for (const workspace of ["e2e", "foreign"]) {
		await db.query(
			'INSERT INTO "Workspace" (id,name,"createdById") VALUES ($1,$1,\'e2e-user\')',
			[workspace],
		);
		await db.query(
			'INSERT INTO "Membership" ("workspaceId","userId",role) VALUES ($1,\'e2e-user\',\'owner\')',
			[workspace],
		);
	}
	area = await store.createArea(db, "e2e", {
		name: "Synthetic Kalteng",
		geometry: {
			type: "Polygon",
			coordinates: [
				[
					[113, -3.6],
					[115, -3.6],
					[115, -1.5],
					[113, -1.5],
					[113, -3.6],
				],
			],
		},
	});
});
afterEach(async () => {
	if (!process.env.RESEARCH_TEST_DATABASE_URL) return;
	await client?.$disconnect();
	if (schema) setup("drop");
	if (root) await rm(root, { recursive: true, force: true });
});
const input = (changes = {}) => ({
	requestId: randomUUID(),
	areaId: area.id,
	areaRevision: 1,
	period: { start: "2019-09-01", end: "2019-09-30" },
	comparisonPeriod: { start: "2018-09-01", end: "2018-09-30" },
	baseline: { kind: "rolling-same-calendar-period", windowYears: 10 },
	referenceScale: "MODIS-equivalent",
	qualityPolicyVersion: "quality-policy-1",
	monitoringLocationId: null,
	...changes,
});
const register = () =>
	command(process.execPath, ["scripts/research-worker.mjs", "--register"]);
const run = () =>
	JSON.parse(
		command(process.execPath, ["scripts/research-worker.mjs", "--once"]).trim(),
	);

native(
	"PostgreSQL private publisher rejects incomplete or inconsistent daily series before committing",
	async () => {
		register();
		const submission = await store.submitAnalysis(
			db,
			"e2e",
			"e2e-user",
			input(),
		);
		const job = await client.p1AnalysisJob.findUnique({
			where: { id: submission.value.id },
		});
		const claim = {
			jobId: job.id,
			workspaceId: job.workspaceId,
			attemptId: randomUUID(),
			leaseToken: randomUUID(),
		};
		await db.transaction(async (tx) => {
			await tx.query(
				'UPDATE "P1AnalysisJob" SET status=\'running\',"startedAt"=clock_timestamp() WHERE id=$1',
				[job.id],
			);
			await tx.query(
				'INSERT INTO "P1AnalysisJobAttempt" (id,"jobId","workspaceId","attemptNo","leaseToken","claimedAt","heartbeatAt","leaseExpiresAt") VALUES ($1,$2,$3,1,$4::uuid,clock_timestamp(),clock_timestamp(),clock_timestamp()+INTERVAL \'60 seconds\')',
				[claim.attemptId, job.id, job.workspaceId, claim.leaseToken],
			);
		});
		const bundle = JSON.parse(
			command(python, ["pipeline/research_worker.py"], {
				input: JSON.stringify({
					root: env.RESEARCH_DATA_DIR,
					run: { id: job.id, workspaceId: job.workspaceId, input: job.input },
				}),
			}),
		);
		for (const mutate of [
			(value) => {
				value.days[0].days = [];
			},
			(value) => {
				value.days[0].days.pop();
			},
			(value) => {
				value.days.push(structuredClone(value.days[0]));
			},
			(value) => {
				value.days[0].nextCursor = "incomplete-page";
			},
			(value) => {
				value.days[0].month = "2019-08";
				for (const day of value.days[0].days)
					day.date = day.date.replace("2019-09", "2019-08");
			},
			(value) => {
				value.days[0].days[0].metric.harmonizedCount = 999;
			},
		]) {
			const invalid = structuredClone(bundle);
			mutate(invalid);
			const result = spawnSync(
				process.execPath,
				["scripts/research-p1-publish.mjs"],
				{
					env,
					input: JSON.stringify({ claim, bundle: invalid }),
					encoding: "utf8",
					timeout: 15000,
				},
			);
			assert.equal(result.status, 1, "Invalid daily evidence was published");
			assert.doesNotMatch(
				result.stdout + result.stderr,
				/postgresql|stack|password/,
			);
			assert.equal(await client.analysisResult.count(), 0);
			assert.equal(await client.analysisManifest.count(), 0);
		}
		const receipt = JSON.parse(
			command(process.execPath, ["scripts/research-p1-publish.mjs"], {
				input: JSON.stringify({ claim, bundle }),
			}),
		);
		assert.equal(receipt.status, "succeeded");
		assert.equal(
			(
				await reads.readResearchDays(
					db,
					storage,
					"e2e",
					"e2e-user",
					receipt.resultId,
					"primary",
					"2019-09",
				)
			).days.length,
			30,
		);
	},
);

native(
	"PostgreSQL authentic P1 submission, worker, location, inspections and protected exports complete end-to-end",
	async (t) => {
		register();
		const body = input();
		const handlers = createResearchAnalysisHandlers({
			session: async () => ({ user: { id: "e2e-user" } }),
			enabled: () => true,
			database: () => db,
			artifacts: () => storage,
		});
		t.mock.method(globalThis, "fetch", async (url, options) => {
			const uri = new URL(url, "http://localhost"), request = new Request(uri, options);
			const params = Promise.resolve({ workspaceId: "e2e", jobId: uri.pathname.split("/").at(-1), analysisId: uri.pathname.split("/").at(-1) });
			return request.method === "POST" ? handlers.POST(request, { params }) : uri.pathname.includes("/jobs/") ? handlers.jobGET(request, { params }) : handlers.resultGET(request, { params });
		});
		const responses = await Promise.all(
			Array.from({ length: 3 }, () =>
				handlers.POST(
					new Request("http://localhost/api/v2/workspaces/e2e/analyses", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body),
					}),
					{ params: Promise.resolve({ workspaceId: "e2e" }) },
				),
			),
		);
		assert.ok(
			responses.every(
				(response) =>
					response.status === 202 &&
					response.headers.get("cache-control") === "private, no-store",
			),
		);
		const queued = { value: await responses[0].json(), status: 202 };
		for (const response of responses.slice(1))
			assert.equal((await response.json()).id, queued.value.id);
		assert.equal(await client.p1AnalysisJob.count(), 1);
		assert.equal(queued.value.status, "queued");
		assert.equal(await client.analysisRun.count(), 0);
		assert.equal(run().status, "succeeded");
		const job = await reads.readResearchJob(
			db,
			"e2e",
			"e2e-user",
			queued.value.id,
		);
		const result = await reads.readResearchAnalysis(
			db,
			"e2e",
			"e2e-user",
			job.resultId,
		);
		assert.equal(result.mode, "demo");
		assert.equal(result.method.validation, "validated");
		assert.equal(result.primary.metric.harmonizedCount, 0.5);
		const page = await reads.readResearchDetections(
			db,
			storage,
			"e2e",
			"e2e-user",
			result.id,
			"primary",
			null,
		);
		const day = await reads.readResearchDays(
			db,
			storage,
			"e2e",
			"e2e-user",
			result.id,
			"primary",
			"2019-09",
		);
		assert.equal(
			day.days.reduce(
				(sum, item) => sum + (item.metric.harmonizedCount ?? 0),
				0,
			),
			0.5,
		);
		const location = await locations.createMonitoringLocation(
			{ database: db, artifacts: storage },
			"e2e",
			"e2e-user",
			{
				requestId: randomUUID(),
				analysisId: result.id,
				anchorDetectionId: page.observations[0].id,
				name: "Original evidence",
			},
		);
		const assignment = await assignments.createInspectionAssignment(
			db,
			"e2e",
			"e2e-user",
			location.id,
			{ requestId: randomUUID(), assigneeUserId: "e2e-user" },
		);
		await reports.createResearchReport(db, "e2e", "e2e-user", assignment.id, {
			requestId: randomUUID(),
			inspectorUserId: "e2e-user",
			observedAt: "2020-01-01T00:00:00Z",
			outcome: "inconclusive",
			notes: "Synthetic E2E inspection",
		});
		const secondLocation = await locations.createMonitoringLocation(
			{ database: db, artifacts: storage },
			"e2e",
			"e2e-user",
			{
				requestId: randomUUID(),
				analysisId: result.id,
				anchorDetectionId: page.observations[0].id,
				name: "Second follow-up destination",
			},
		);
		const followup = await store.submitAnalysis(
			db,
			"e2e",
			"e2e-user",
			input({
				monitoringLocationId: location.id,
				period: { start: "2019-10-01", end: "2019-10-31" },
			}),
		);
		const sharedFollowup = await store.submitAnalysis(
			db,
			"e2e",
			"e2e-user",
			input({
				monitoringLocationId: secondLocation.id,
				period: { start: "2019-10-01", end: "2019-10-31" },
			}),
		);
		assert.equal(sharedFollowup.value.id, followup.value.id);
		const consumerInput = input({ monitoringLocationId: location.id, period: { start: "2019-10-01", end: "2019-10-31" } });
		const consumerQueued = await consumer.submitResearch("e2e", consumerInput, new AbortController().signal);
		assert.equal(run().status, "succeeded");
		const next = await reads.readResearchJob(
			db,
			"e2e",
			"e2e-user",
			followup.value.id,
		);
		assert.equal((await consumer.watchResearch("e2e", consumerQueued, consumerInput, new AbortController().signal, () => {})).id, next.resultId);
		assert.ok(
			await client.monitoringLocationAnalysis.findUnique({
				where: {
					locationId_analysisId: {
						locationId: location.id,
						analysisId: next.resultId,
					},
				},
			}),
		);
		assert.ok(
			await client.monitoringLocationAnalysis.findUnique({
				where: {
					locationId_analysisId: {
						locationId: secondLocation.id,
						analysisId: next.resultId,
					},
				},
			}),
		);
		assert.deepEqual(
			(
				await locations.getMonitoringLocation(
					{ database: db },
					"e2e",
					"e2e-user",
					location.id,
				)
			).anchor,
			location.anchor,
		);
		for (const kind of ["raw-hotspots-csv", "harmonized-aggregates-csv"]) {
			const exported = await exportsService.createResearchExport(
				{ database: db, storage },
				"e2e",
				"e2e-user",
				{
					requestId: randomUUID(),
					analysisId: result.id,
					kind,
					periodRole: "primary",
				},
			);
			assert.equal(
				(await exportWorker.runResearchExportOnce({ database: db, storage }))
					.status,
				"ready",
			);
			const manifest = await exportsService.getResearchExportManifest(
				{ database: db, storage },
				"e2e",
				"e2e-user",
				exported.value.id,
			);
			assert.equal(manifest.analysisId, result.id);
			assert.equal(manifest.inspectionContext.reports.length, 1);
			assert.equal(
				manifest.provenance.producerMetadata.modelChecksum.startsWith(
					"sha256:",
				),
				true,
			);
		}
		assert.deepEqual(
			await store.submitAnalysis(db, "e2e", "e2e-user", body),
			queued,
		);
		await assert.rejects(
			() =>
				store.submitAnalysis(db, "e2e", "e2e-user", {
					...body,
					monitoringLocationId: location.id,
				}),
			(error) => error.code === "IDEMPOTENCY_CONFLICT",
		);
		const cachedFollowup = await store.submitAnalysis(
			db,
			"e2e",
			"e2e-user",
			input({ monitoringLocationId: location.id }),
		);
		assert.equal(cachedFollowup.value.id, queued.value.id);
	},
);

native(
	"PostgreSQL model and baseline content versions invalidate P1 cache and foreign locations are rejected",
	async () => {
		register();
		const first = await store.submitAnalysis(db, "e2e", "e2e-user", input());
		const modelFile = path.join(
			env.RESEARCH_MODELS_DIR,
			(await readdir(env.RESEARCH_MODELS_DIR)).find((name) =>
				name.startsWith("model-"),
			),
		);
		const originalModel = await readFile(modelFile, "utf8");
		const baselineFile = path.join(
			env.RESEARCH_MODELS_DIR,
			(await readdir(env.RESEARCH_MODELS_DIR)).find((name) =>
				name.startsWith("baseline-"),
			),
		);
		const originalBaseline = await readFile(baselineFile, "utf8");
		const changed = JSON.parse(originalModel);
		changed.ratio = 0.9;
		await writeFile(modelFile, JSON.stringify(changed));
		assert.equal(run().status, "succeeded");
		const frozenJob = await reads.readResearchJob(
			db,
			"e2e",
			"e2e-user",
			first.value.id,
		);
		assert.equal(
			(
				await reads.readResearchAnalysis(
					db,
					"e2e",
					"e2e-user",
					frozenJob.resultId,
				)
			).primary.metric.harmonizedCount,
			0.5,
		);
		const same = await store.submitAnalysis(db, "e2e", "e2e-user", input());
		assert.equal(same.value.id, first.value.id);
		let previousId = same.value.id;
		for (const prefix of ["model-", "baseline-"]) {
			const file = (await readdir(env.RESEARCH_MODELS_DIR)).find((name) =>
				name.startsWith(prefix),
			);
			const target = path.join(env.RESEARCH_MODELS_DIR, file);
			const document = JSON.parse(await readFile(target, "utf8"));
			if (prefix === "model-") document.ratio = 0.375;
			else document.minimumValidYears = 3;
			await writeFile(target, JSON.stringify(document));
			register();
			const fresh = await store.submitAnalysis(db, "e2e", "e2e-user", input());
			assert.notEqual(fresh.value.id, previousId);
			previousId = fresh.value.id;
			assert.equal(run().status, "succeeded");
		}
		await writeFile(modelFile, originalModel);
		await writeFile(baselineFile, originalBaseline);
		register();
		assert.equal(
			(await store.submitAnalysis(db, "e2e", "e2e-user", input())).value.id,
			first.value.id,
		);
		const foreignArea = await store.createArea(db, "foreign", {
			name: "Other workspace",
			geometry: area.geometry,
		});
		const foreign = await store.submitAnalysis(
			db,
			"foreign",
			"e2e-user",
			input({ areaId: foreignArea.id }),
		);
		assert.equal(run().status, "succeeded");
		const job = await reads.readResearchJob(
			db,
			"foreign",
			"e2e-user",
			foreign.value.id,
		);
		const result = await observations.readPublishedAnalysis(
			db,
			"foreign",
			job.resultId,
		);
		const values = [];
		for await (const value of observations.iterateResearchObservations(
			db,
			storage,
			result,
			{ periodRole: "primary" },
		))
			values.push(value);
		const location = await locations.createMonitoringLocation(
			{ database: db, artifacts: storage },
			"foreign",
			"e2e-user",
			{
				requestId: randomUUID(),
				analysisId: result.id,
				anchorDetectionId: values[0].id,
				name: "Foreign original",
			},
		);
		await assert.rejects(
			() =>
				store.submitAnalysis(
					db,
					"e2e",
					"e2e-user",
					input({ monitoringLocationId: location.id }),
				),
			(error) => error.code === "NOT_FOUND",
		);
	},
);

native(
	"PostgreSQL raw and missing-data producer jobs succeed without inventing harmonized values",
	async () => {
		env.RESEARCH_MODELS_DIR = path.join(root, "explicit-raw-models");
		register();
		for (const period of [
			{ start: "2019-09-01", end: "2019-09-30" },
			{ start: "2005-01-01", end: "2005-01-31" },
		]) {
			const queued = await store.submitAnalysis(
				db,
				"e2e",
				"e2e-user",
				input({ period, comparisonPeriod: null }),
			);
			assert.equal(run().status, "succeeded");
			const job = await reads.readResearchJob(
				db,
				"e2e",
				"e2e-user",
				queued.value.id,
			);
			const result = await reads.readResearchAnalysis(
				db,
				"e2e",
				"e2e-user",
				job.resultId,
			);
			assert.equal(result.method.validation, "unsupported");
			assert.equal(result.primary.metric.harmonizedCount, null);
			if (period.start.startsWith("2005")) {
				assert.equal(result.primary.metric.rawCount, null);
				assert.equal(result.primary.metric.status, "no_data");
			}
			const exported = await exportsService.createResearchExport(
				{ database: db, storage },
				"e2e",
				"e2e-user",
				{
					requestId: randomUUID(),
					analysisId: result.id,
					periodRole: "primary",
					kind: "raw-hotspots-csv",
				},
			);
			assert.equal(
				(await exportWorker.runResearchExportOnce({ database: db, storage }))
					.status,
				"ready",
			);
			const manifest = await exportsService.getResearchExportManifest(
				{ database: db, storage },
				"e2e",
				"e2e-user",
				exported.value.id,
			);
			assert.equal(
				manifest.summary.metric.rawCount,
				result.primary.metric.rawCount,
			);
		}
		await new Promise((resolve, reject) => {
			const child = spawn(python, ["pipeline/research_p1_worker.py"], {
				env,
				stdio: ["pipe", "pipe", "ignore"],
				windowsHide: true,
			});
			let output = "";
			const timeout = setTimeout(() => {
				child.kill();
				reject(new Error("Synthetic worker shutdown timed out"));
			}, 10000);
			child.stdout.on("data", (chunk) => {
				output += chunk;
				if (output.includes('"idle"') && !child.stdin.writableEnded)
					child.stdin.end("stop\n");
			});
			child.once("error", reject);
			child.once("close", (code) => {
				clearTimeout(timeout);
				try {
					assert.equal(code, 0);
					assert.doesNotMatch(output, /postgresql|stack|password/);
					resolve();
				} catch (error) {
					reject(error);
				}
			});
		});
	},
);

native(
	"PostgreSQL failed follow-up link publication rolls back the new result and preserves original evidence",
	async () => {
		register();
		const initial = await store.submitAnalysis(db, "e2e", "e2e-user", input());
		assert.equal(run().status, "succeeded");
		const job = await reads.readResearchJob(
			db,
			"e2e",
			"e2e-user",
			initial.value.id,
		);
		const page = await reads.readResearchDetections(
			db,
			storage,
			"e2e",
			"e2e-user",
			job.resultId,
			"primary",
			null,
		);
		const location = await locations.createMonitoringLocation(
			{ database: db, artifacts: storage },
			"e2e",
			"e2e-user",
			{
				requestId: randomUUID(),
				analysisId: job.resultId,
				anchorDetectionId: page.observations[0].id,
				name: "Immutable original",
			},
		);
		const followup = await store.submitAnalysis(
			db,
			"e2e",
			"e2e-user",
			input({
				monitoringLocationId: location.id,
				period: { start: "2019-10-01", end: "2019-10-31" },
			}),
		);
		await client.$executeRawUnsafe(
			`CREATE FUNCTION reject_e2e_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic-private-link-error'; END; $$`,
		);
		await client.$executeRawUnsafe(
			'CREATE TRIGGER reject_e2e_link BEFORE INSERT ON "MonitoringLocationAnalysis" FOR EACH ROW EXECUTE FUNCTION reject_e2e_link()',
		);
		const failed = spawnSync(
			process.execPath,
			["scripts/research-worker.mjs", "--once"],
			{ env, encoding: "utf8", timeout: 30000 },
		);
		assert.equal(failed.status, 1);
		assert.doesNotMatch(
			failed.stdout + failed.stderr,
			/synthetic-private-link-error|postgresql|stack/,
		);
		assert.equal(await client.analysisResult.count(), 1);
		assert.equal(await client.analysisManifest.count(), 1);
		assert.equal(await client.monitoringLocationAnalysis.count(), 1);
		assert.equal(
			(await reads.readResearchJob(db, "e2e", "e2e-user", followup.value.id))
				.resultId,
			null,
		);
		assert.deepEqual(
			(
				await locations.getMonitoringLocation(
					{ database: db },
					"e2e",
					"e2e-user",
					location.id,
				)
			).anchor,
			location.anchor,
		);
		await client.$executeRawUnsafe(
			'DROP TRIGGER reject_e2e_link ON "MonitoringLocationAnalysis"',
		);
		await new Promise((resolve) => setTimeout(resolve, 5100));
		assert.equal(run().status, "succeeded");
		assert.equal(await client.analysisResult.count(), 2);
		assert.equal(await client.monitoringLocationAnalysis.count(), 2);
	},
);
