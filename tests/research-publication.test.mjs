import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
	applyResearchMigrations,
	artifact,
	makeRawResult,
	pgliteDatabase,
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
let publication, storageModule;
try {
	publication = await import("../src/lib/research-publication.ts");
	storageModule = await import("../src/lib/research-publication-storage.ts");
} finally {
	hook.deregister();
}

let db,
	sequence = 0,
	root,
	database,
	storage,
	request,
	fixture,
	events;
before(async () => {
	db = await PGlite.create();
	root = await mkdtemp(path.join(tmpdir(), "research-publication-"));
});
after(async () => {
	await db?.close();
	if (root) await rm(root, { recursive: true, force: true });
});
beforeEach(async () => {
	assert.equal(
		typeof publication.publishResearchResult,
		"function",
		"Research publication service is not implemented",
	);
	await db.exec(
		`CREATE SCHEMA publication_${++sequence}; SET search_path TO publication_${sequence}, public;`,
	);
	await applyResearchMigrations(db);
	database = pgliteDatabase(db);
	({ request, fixture } = publicationFixture());
	await seedPublication(database, fixture);
	storage = new storageModule.FileResearchArtifactStorage(
		path.join(root, String(sequence)),
	);
	events = [];
});
const publish = (changes = {}) =>
	publication.publishResearchResult(
		{ database, storage, log: (e) => events.push(e), ...changes },
		request,
	);
const rows = async (table) => (await db.query(`SELECT * FROM "${table}"`)).rows;
const fails = (run, code) =>
	assert.rejects(
		run,
		(error) => error.code === code && !error.message.includes("sentinel"),
	);

test("raw unsupported output publishes one immutable result with verified private artifacts", async () => {
	makeRawResult(request);
	const result = await publish();
	const [job] = await rows("P1AnalysisJob"),
		[attempt] = await rows("P1AnalysisJobAttempt");
	assert.equal(job.status, "succeeded");
	assert.equal(attempt.status, "succeeded");
	assert.equal(job.resultId, result.resultId);
	const [stored] = await rows("AnalysisResult");
	assert.equal(stored.payload.primary.metric.harmonizedCount, null);
	assert.equal(stored.payload.method.validation, "unsupported");
	const [metadata] = await rows("P1AnalysisArtifact");
	assert.equal(metadata.checksum, request.artifacts[0].checksum);
	assert.equal(Number(metadata.bytes), request.artifacts[0].bytes);
	assert.match(metadata.objectKey, /^research\/[a-f0-9]{64}\//);
	assert.deepEqual(
		await readFile(path.join(storage.root, metadata.objectKey)),
		request.artifacts[0].content,
	);
	assert.equal((await rows("AnalysisManifest")).length, 1);
});

test("missing counts stay null after publication", async () => {
	makeRawResult(request);
	const payload = request.producer.result;
	for (const entry of [
		payload.primary,
		payload.comparison,
		...payload.months,
	].filter(Boolean)) {
		entry.metric = {
			rawCount: null,
			harmonizedCount: null,
			rawCountsBySource: Object.fromEntries(
				payload.sources.map((s) => [s.id, null]),
			),
			status: "no_data",
		};
	}
	await publish();
	assert.equal(
		(await rows("AnalysisResult"))[0].payload.primary.metric.rawCount,
		null,
	);
});

test("Nathan raw producer output passes publication without promoting its scientific status", async () => {
	const output = await mkdtemp(path.join(root, "nathan-fixture-"));
	const run = spawnSync(
		process.env.PYTHON || "python",
		[
			"-m",
			"unittest",
			"test_research_adapter.AdapterTests.test_dump_outputs_for_schema_validation",
		],
		{
			cwd: new URL("../pipeline/", import.meta.url),
			env: { ...process.env, ADAPTER_OUT: output },
			encoding: "utf8",
			timeout: 15000,
		},
	);
	assert.equal(run.status, 0, "Synthetic Nathan producer fixture failed");
	const result = JSON.parse(
		await readFile(path.join(output, "result.json"), "utf8"),
	);
	result.mode = "demo";
	const data = publicationFixture();
	fixture = data.fixture;
	request = data.request;
	fixture.job.id = "nathan-job";
	fixture.job.requestId = "77777777-7777-4777-8777-777777777777";
	fixture.job.areaId = result.area.id;
	fixture.job.input.area = {
		...result.area,
		workspaceId: fixture.job.workspaceId,
	};
	fixture.job.input.request = {
		...fixture.job.input.request,
		requestId: fixture.job.requestId,
		areaId: result.area.id,
		period: result.primary.period,
		comparisonPeriod: result.comparison.period,
		qualityPolicyVersion: result.qualityPolicyVersion,
	};
	fixture.job.input.versions = {
		dataVersion: result.dataVersion,
		modelVersion: result.method.version,
		satelliteConfigVersion: "satellite-config-1",
		aggregationVersion: "pcd1",
	};
	fixture.job.input.baselinePolicy = {
		version: result.baseline.policyVersion,
		minimumValidYears: result.baseline.minimumValidYears,
	};
	fixture.attempt.id = "nathan-attempt";
	fixture.attempt.jobId = fixture.job.id;
	fixture.attempt.leaseToken = "88888888-8888-4888-8888-888888888888";
	request.claim = {
		jobId: fixture.job.id,
		workspaceId: fixture.job.workspaceId,
		attemptId: fixture.attempt.id,
		leaseToken: fixture.attempt.leaseToken,
	};
	request.producer = {
		result,
		manifest: {
			...fixture.manifest,
			id: result.method.manifestId,
			...fixture.job.input.versions,
			areaId: result.area.id,
			geometryHash: result.area.geometryHash,
			qualityPolicyVersion: result.qualityPolicyVersion,
			baselinePolicyVersion: result.baseline.policyVersion,
			sourceSnapshots: result.sources.map((source) => ({
				sourceId: source.id,
				processingLevel: source.processingLevel,
				productVersion: source.version,
				checksum: source.checksum,
				batchIds: [],
				archiveRevision: source.checksum,
				ingestedAt: null,
			})),
		},
	};
	await seedPublication(database, fixture);
	const receipt = await publish();
	const stored = (await rows("AnalysisResult")).find(
		(r) => r.id === receipt.resultId,
	);
	assert.equal(stored.payload.method.validation, "unsupported");
	assert.equal(
		stored.payload.primary.metric.rawCount,
		result.primary.metric.rawCount,
	);
	assert.equal(stored.payload.primary.metric.harmonizedCount, null);
	assert.equal(
		stored.payload.months.at(-1).metric.status,
		result.months.at(-1).metric.status,
	);
	assert.equal(stored.payload.mode, "demo");
});

test("invalid producer schema and mismatched pinned data versions never publish", async () => {
	request.producer.result.method.unit = "detected-cell-days";
	await fails(() => publish(), "INVALID_OUTPUT");
	request.producer.result.method.unit = "estimated-hotspot-detections";
	request.producer.result.dataVersion = "different-archive";
	await fails(() => publish(), "INVALID_OUTPUT");
	assert.equal((await rows("AnalysisResult")).length, 0);
});

test("declared checksum or byte length mismatch fails before database publication", async () => {
	request.artifacts[0].checksum = `sha256:${"e".repeat(64)}`;
	await fails(() => publish(), "ARTIFACT_MISMATCH");
	request.artifacts[0] = { ...artifact(), bytes: 1 };
	await fails(() => publish(), "ARTIFACT_MISMATCH");
	assert.equal((await rows("AnalysisResult")).length, 0);
});

test("storage failure halfway through staging cannot expose a partial result", async () => {
	request.artifacts.push(artifact("daily"));
	let puts = 0;
	const failedStorage = {
		put: async (...args) => {
			if (++puts === 2) throw new Error("storage-credential-sentinel");
			return storage.put(...args);
		},
		verify: (...args) => storage.verify(...args),
	};
	await fails(() => publish({ storage: failedStorage }), "STORAGE_FAILED");
	assert.equal((await rows("P1AnalysisArtifact")).length, 0);
	assert.equal((await rows("P1AnalysisJob"))[0].status, "running");
});

test("database failure after manifest insertion rolls back metadata, result and completion", async () => {
	await db.exec(`CREATE FUNCTION reject_result() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'database-secret-sentinel'; END; $$;
    CREATE TRIGGER reject_result BEFORE INSERT ON "AnalysisResult" FOR EACH ROW EXECUTE FUNCTION reject_result();`);
	await fails(() => publish(), "DATABASE_FAILED");
	for (const table of [
		"AnalysisManifest",
		"AnalysisResult",
		"P1AnalysisArtifact",
	])
		assert.equal((await rows(table)).length, 0);
	assert.equal((await rows("P1AnalysisJobAttempt"))[0].status, "running");
});

test("failure in final job update rolls back every preceding write", async () => {
	await db.exec(`CREATE FUNCTION reject_success() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."status"='succeeded' THEN RAISE EXCEPTION 'transaction-sentinel'; END IF; RETURN NEW; END; $$;
    CREATE TRIGGER reject_success BEFORE UPDATE ON "P1AnalysisJob" FOR EACH ROW EXECUTE FUNCTION reject_success();`);
	await fails(() => publish(), "DATABASE_FAILED");
	for (const table of [
		"AnalysisManifest",
		"AnalysisResult",
		"P1AnalysisArtifact",
	])
		assert.equal((await rows(table)).length, 0);
	assert.equal((await rows("P1AnalysisJobAttempt"))[0].status, "running");
});

test("unavailable artifact is rejected by the final verification inside the transaction", async () => {
	let verifies = 0;
	const unavailable = {
		put: (...args) => storage.put(...args),
		verify: async (...args) => {
			if (++verifies === 2) throw new Error("not available");
			return storage.verify(...args);
		},
	};
	await fails(() => publish({ storage: unavailable }), "STORAGE_FAILED");
	assert.equal((await rows("AnalysisResult")).length, 0);
	assert.equal((await rows("P1AnalysisJobAttempt"))[0].status, "running");
});

test("secret-bearing metadata, bytes and logging exceptions never escape", async () => {
	const secret = "private-publication-credential-sentinel";
	request.producer.manifest.sourceSnapshots[0].archiveRevision = secret;
	await fails(() => publish({ secrets: [secret] }), "UNSAFE_METADATA");
	assert.ok(!JSON.stringify(events).includes(secret));
	request.producer.manifest.sourceSnapshots[0].archiveRevision =
		"synthetic-archive";
	request.artifacts[0] = artifact("observations", Buffer.from(secret));
	await fails(() => publish({ secrets: [secret] }), "UNSAFE_METADATA");
	request.artifacts[0] = artifact();
	const result = await publish({
		log: () => {
			throw new Error(secret);
		},
	});
	assert.ok(result.resultId);
	assert.ok(!JSON.stringify(await rows("P1AnalysisArtifact")).includes(secret));
	assert.ok(!JSON.stringify(events).includes(request.claim.leaseToken));
});

test("JSON escaping cannot hide configured credentials in producer metadata", async () => {
	const secret = 'private-"credential-sentinel';
	request.producer.manifest.sourceSnapshots[0].archiveRevision = secret;
	await fails(() => publish({ secrets: [secret] }), "UNSAFE_METADATA");
	assert.equal((await rows("AnalysisResult")).length, 0);
});

test("JSON artifact values are checked after decoding escaped credentials", async () => {
	const secret = 'private-"artifact-sentinel';
	request.artifacts[0] = artifact(
		"observations",
		Buffer.from(JSON.stringify({ credential: secret })),
	);
	await fails(() => publish({ secrets: [secret] }), "UNSAFE_METADATA");
	assert.equal((await rows("AnalysisResult")).length, 0);
});

test("the claim lease token is automatically rejected from metadata and artifact content", async () => {
	const original = request.producer.manifest.sourceSnapshots[0].archiveRevision;
	request.producer.manifest.sourceSnapshots[0].archiveRevision =
		request.claim.leaseToken;
	await fails(() => publish(), "UNSAFE_METADATA");
	request.producer.manifest.sourceSnapshots[0].archiveRevision = original;
	request.artifacts[0] = artifact(
		"observations",
		Buffer.from(JSON.stringify({ lease: request.claim.leaseToken })),
	);
	await fails(() => publish(), "UNSAFE_METADATA");
	assert.equal((await rows("AnalysisResult")).length, 0);
	assert.ok(!JSON.stringify(events).includes(request.claim.leaseToken));
});

test("untrusted dependency error codes cannot leak through returned errors or logs", async () => {
	const secret = "private-adapter-error-sentinel";
	for (const forged of [
		new publication.PublicationFailure(secret),
		new publication.PublicationFailure("STORAGE_FAILED"),
	]) {
		forged.code = secret;
		const broken = {
			...database,
			query: async () => {
				throw forged;
			},
		};
		await assert.rejects(
			() => publish({ database: broken, secrets: [secret] }),
			(error) =>
				["INVALID_OUTPUT", "DATABASE_FAILED"].includes(error.code) &&
				!error.message.includes(secret),
		);
	}
	assert.ok(!JSON.stringify(events).includes(secret));
});

test("lost lease, wrong token and superseded attempt cannot publish", async () => {
	request.claim.leaseToken = "44444444-4444-4444-8444-444444444444";
	await fails(() => publish(), "LEASE_LOST");
	request.claim.leaseToken = fixture.attempt.leaseToken;
	await db.query(
		`UPDATE "P1AnalysisJobAttempt" SET "status"='failed', "completedAt"=$1, "errorCode"='PROCESSOR_FAILED', "retryable"=true`,
		[fixture.attempt.heartbeatAt],
	);
	await fails(() => publish(), "LEASE_LOST");
	assert.equal((await rows("AnalysisResult")).length, 0);
});

test("retry after an ambiguous committed response reuses the same result without new rows", async () => {
	const ambiguous = {
		...database,
		transaction: async (run) => {
			await database.transaction(run);
			throw new Error("connection-private-sentinel");
		},
	};
	await fails(() => publish({ database: ambiguous }), "DATABASE_FAILED");
	const [original] = await rows("AnalysisResult");
	const recovered = await publish();
	assert.equal(recovered.resultId, original.id);
	assert.equal(recovered.reused, true);
	assert.equal((await rows("AnalysisResult")).length, 1);
	assert.equal((await rows("P1AnalysisArtifact")).length, 1);
});

test("a changed retry conflicts while the original result and bytes remain intact", async () => {
	const original = await publish();
	request.producer.result.method.validationDomain = "different evidence";
	await fails(() => publish(), "PUBLICATION_CONFLICT");
	assert.equal((await rows("AnalysisResult"))[0].id, original.resultId);
});

test("a failed new job preserves an earlier published result and its readable artifacts", async () => {
	const original = await publish();
	const previous = (await rows("AnalysisResult"))[0];
	const metadata = (await rows("P1AnalysisArtifact"))[0];
	({ request, fixture } = publicationFixture());
	fixture.job.id = "new-job";
	fixture.job.requestId = fixture.job.input.request.requestId =
		"55555555-5555-4555-8555-555555555555";
	fixture.attempt.id = "new-attempt";
	fixture.attempt.jobId = fixture.job.id;
	fixture.attempt.leaseToken = "66666666-6666-4666-8666-666666666666";
	request.claim = {
		jobId: fixture.job.id,
		workspaceId: fixture.job.workspaceId,
		attemptId: fixture.attempt.id,
		leaseToken: fixture.attempt.leaseToken,
	};
	await seedPublication(database, fixture);
	await db.exec(`CREATE FUNCTION reject_new_result() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW."jobId"='new-job' THEN RAISE EXCEPTION 'new-job-database-sentinel'; END IF; RETURN NEW; END; $$;
    CREATE TRIGGER reject_new_result BEFORE INSERT ON "AnalysisResult" FOR EACH ROW EXECUTE FUNCTION reject_new_result();`);
	await fails(() => publish(), "DATABASE_FAILED");
	assert.deepEqual(
		(await rows("AnalysisResult")).find((r) => r.id === original.resultId),
		previous,
	);
	assert.deepEqual(
		await readFile(path.join(storage.root, metadata.objectKey)),
		artifact().content,
	);
});

test("immutable storage permits identical puts but rejects replacements and traversal", async () => {
	const key = "research/test/file.json",
		original = Buffer.from("original");
	await storage.put(key, original);
	await storage.put(key, original);
	await fails(
		() => storage.put(key, Buffer.from("replacement")),
		"ARTIFACT_MISMATCH",
	);
	await fails(() => storage.put("../escape", original), "STORAGE_FAILED");
	assert.equal(
		(await readFile(path.join(storage.root, key))).toString(),
		"original",
	);
});

test("artifact roots cannot be placed in Next.js public or static directories", () => {
	for (const folder of ["public/private", ".next/static/private"]) {
		assert.throws(
			() => new storageModule.FileResearchArtifactStorage(path.resolve(folder)),
			(error) => error.code === "STORAGE_FAILED",
		);
	}
});

test("tampered files are detected on read-back without exposing their content", async () => {
	const key = "research/test/file.json",
		original = artifact();
	await storage.put(key, original.content);
	await writeFile(path.join(storage.root, key), "different");
	await fails(
		() => storage.verify(key, original.checksum, original.bytes),
		"ARTIFACT_MISMATCH",
	);
	assert.ok((await readdir(storage.root)).includes("research"));
});
