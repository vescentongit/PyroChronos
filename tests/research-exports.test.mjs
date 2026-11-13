import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { applyResearchMigrations } from "./helpers/research-publication-fixtures.mjs";
import {
	exportsService as api,
	exportWorker,
	exportQueue,
	exportFixture,
	assignments,
	reports,
	Storage,
	sqlAdapter,
} from "./helpers/research-export-fixtures.mjs";

let pg,
	root,
	db,
	storage,
	f,
	sequence = 0;
before(async () => {
	pg = await PGlite.create();
	root = await mkdtemp(path.join(tmpdir(), "research-exports-"));
});
after(async () => {
	await pg?.close();
	if (root) await rm(root, { recursive: true, force: true });
});
beforeEach(async () => {
	await pg.exec(
		`CREATE SCHEMA exports_${++sequence}; SET search_path TO exports_${sequence}, public`,
	);
	await applyResearchMigrations(pg);
	db = sqlAdapter(pg);
	storage = new Storage(path.join(root, String(sequence)));
	f = await exportFixture(db, storage);
});
const body = (changes = {}) => ({
	requestId: randomUUID(),
	analysisId: f.analysisId,
	periodRole: "primary",
	kind: "raw-hotspots-csv",
	...changes,
});
const create = (input = body(), actor = f.user) =>
	api.createResearchExport(f.dependencies, f.workspace, actor, input);
const run = (changes = {}) =>
	exportWorker.runResearchExportOnce({ ...f.dependencies, ...changes });
const rejects = (action, code) =>
	assert.rejects(action, (error) => error.code === code);
const rows = (table) => db.query(`SELECT * FROM "${table}" ORDER BY id`);
async function csv(id) {
	const file = await api.getResearchExportDownload(
		f.dependencies,
		f.workspace,
		f.user,
		id,
	);
	const chunks = [];
	for await (const chunk of file.content) chunks.push(chunk);
	return Buffer.concat(chunks).toString("utf8");
}

test("create is idempotent, deduplicates immutable input and rejects conflicting payloads", async () => {
	const input = body();
	const first = await create(input);
	assert.equal(first.status, 202);
	assert.equal(first.value.status, "queued");
	assert.deepEqual(await create(input), first);
	assert.equal((await create()).value.id, first.value.id);
	await rejects(
		() => create({ ...input, kind: "harmonized-aggregates-csv" }),
		"IDEMPOTENCY_CONFLICT",
	);
	await rejects(
		() => create({ ...body(), objectKey: "private/path" }),
		"INVALID_REQUEST",
	);
	assert.equal((await rows("ResearchExport")).length, 1);
});

test("worker publishes verified CSV and protected manifest, ready dedup returns 200", async () => {
	const input = body();
	const created = await create(input);
	assert.equal((await run()).status, "ready");
	const id = created.value.id;
	const current = await api.readResearchExport(
		f.dependencies,
		f.workspace,
		f.user,
		id,
	);
	assert.equal(current.status, "ready");
	assert.match(current.downloadPath, /\/download$/);
	const text = await csv(id);
	assert.match(text, /detection-demo/);
	assert.equal(text.trim().split("\n").length, 2);
	const manifest = await api.getResearchExportManifest(
		f.dependencies,
		f.workspace,
		f.user,
		id,
	);
	assert.equal(manifest.schemaVersion, "research-export-manifest-1");
	assert.equal(manifest.analysisId, f.analysisId);
	assert.equal(manifest.method.validation, "unsupported");
	assert.equal(manifest.csv.rowCount, 1);
	assert.doesNotMatch(
		JSON.stringify(manifest),
		/objectKey|leaseToken|postgresql:|private\/|payloadRef/,
	);
	assert.equal((await create()).status, 200);
	assert.deepEqual(await create(input), created);
	assert.equal((await rows("ResearchExportArtifact")).length, 2);
	assert.equal((await run()).status, "idle");
});

test("aggregate exports preserve unsupported null estimates and comparison is isolated", async () => {
	const primary = await create(body({ kind: "harmonized-aggregates-csv" }));
	await run();
	const text = await csv(primary.value.id);
	assert.match(text, /unsupported/);
	assert.doesNotMatch(text, /NaN|Infinity/);
	const manifest = await api.getResearchExportManifest(
		f.dependencies,
		f.workspace,
		f.user,
		primary.value.id,
	);
	assert.equal(
		manifest.csv.rowCount,
		f.fixture.result.payload.months.length + 1,
	);
	const comparison = await create(
		body({ kind: "harmonized-aggregates-csv", periodRole: "comparison" }),
	);
	await run();
	const compared = await csv(comparison.value.id);
	assert.equal(compared.trim().split("\n").length, 2);
	assert.match(compared, /comparison/);
	assert.doesNotMatch(compared.split("\n")[1], /primary/);
});

test("inspection snapshots freeze current corrections; new requests track newer revisions", async () => {
	const a = await assignments.createInspectionAssignment(
		db,
		f.workspace,
		f.user,
		f.location.id,
		{ requestId: randomUUID(), assigneeUserId: f.user },
	);
	const reportInput = {
		requestId: randomUUID(),
		inspectorUserId: f.user,
		observedAt: "2026-08-01T00:00:00Z",
		outcome: "inconclusive",
		notes: "Original private inspection",
	};
	const report = await reports.createResearchReport(
		db,
		f.workspace,
		f.user,
		a.id,
		reportInput,
	);
	const old = await create();
	await reports.correctResearchReport(db, f.workspace, f.user, report.id, {
		...reportInput,
		requestId: randomUUID(),
		expectedRevision: 1,
		reason: "Updated evidence",
		notes: "Current inspection",
	});
	await run();
	const oldManifest = await api.getResearchExportManifest(
		f.dependencies,
		f.workspace,
		f.user,
		old.value.id,
	);
	assert.equal(oldManifest.inspectionContext.reports[0].revision, 1);
	const latest = await create();
	assert.notEqual(latest.value.id, old.value.id);
	await run();
	const manifest = await api.getResearchExportManifest(
		f.dependencies,
		f.workspace,
		f.user,
		latest.value.id,
	);
	assert.equal(manifest.inspectionContext.reports[0].revision, 2);
	assert.equal(
		manifest.inspectionContext.reports[0].corrections[0].notes,
		reportInput.notes,
	);
});

test("unauthorized and revoked users cannot create, poll or download existing exports", async () => {
	await rejects(() => create(body(), "outsider"), "FORBIDDEN");
	const input = body();
	const created = await create(input);
	await run();
	await db.query(
		'UPDATE "Membership" SET active=false WHERE "workspaceId"=$1 AND "userId"=$2',
		[f.workspace, f.user],
	);
	await rejects(() => create(input), "FORBIDDEN");
	for (const action of [
		api.readResearchExport,
		api.getResearchExportDownload,
		api.getResearchExportManifest,
	])
		await rejects(
			() => action(f.dependencies, f.workspace, f.user, created.value.id),
			"FORBIDDEN",
		);
});

test("staging and database failures cannot publish partial export artifacts", async () => {
	const created = await create();
	const broken = {
		putStream: (...args) => storage.putStream(...args),
		put: async () => {
			throw new Error("private-storage-sentinel");
		},
		verify: (...args) => storage.verify(...args),
		read: (...args) => storage.read(...args),
	};
	assert.equal((await run({ storage: broken })).status, "failed");
	assert.equal((await rows("ResearchExportArtifact")).length, 0);
	await rejects(
		() =>
			api.getResearchExportDownload(
				f.dependencies,
				f.workspace,
				f.user,
				created.value.id,
			),
		"RESULT_NOT_READY",
	);
});

test("corrupt bytes fail before download; input/snapshots/final metadata stay immutable", async () => {
	const created = await create();
	await run();
	for (const query of [
		'UPDATE "ResearchExport" SET "inspectionSnapshot"=\'{}\'::jsonb',
		"UPDATE \"ResearchExportArtifact\" SET checksum='changed'",
		'DELETE FROM "ResearchExportAttempt"',
		'TRUNCATE "ResearchExportArtifact"',
	])
		await assert.rejects(db.query(query));
	const [file] = await db.query(
		"SELECT * FROM \"ResearchExportArtifact\" WHERE kind='csv'",
	);
	await writeFile(path.join(storage.root, file.objectKey), "corrupted");
	await rejects(
		() =>
			api.getResearchExportDownload(
				f.dependencies,
				f.workspace,
				f.user,
				created.value.id,
			),
		"DEPENDENCY_UNAVAILABLE",
	);
});

test("raw export deduplicates repeated original IDs and rejects conflicting copies", async () => {
	const repeated = await exportFixture(db, storage, {
		mutatePage(page) {
			page.observations.push(structuredClone(page.observations[0]));
		},
	});
	const created = await api.createResearchExport(
		repeated.dependencies,
		repeated.workspace,
		repeated.user,
		{ ...body(), analysisId: repeated.analysisId },
	);
	await run();
	assert.equal(
		(
			await api.getResearchExportManifest(
				repeated.dependencies,
				repeated.workspace,
				repeated.user,
				created.value.id,
			)
		).csv.rowCount,
		1,
	);
	const conflicting = await exportFixture(db, storage, {
		skipLocation: true,
		mutatePage(page) {
			page.observations.push({ ...page.observations[0], frpMw: 99 });
		},
	});
	const rejected = await api.createResearchExport(
		conflicting.dependencies,
		conflicting.workspace,
		conflicting.user,
		{ ...body(), analysisId: conflicting.analysisId },
	);
	assert.equal((await run()).status, "failed");
	await rejects(
		() =>
			api.getResearchExportDownload(
				conflicting.dependencies,
				conflicting.workspace,
				conflicting.user,
				rejected.value.id,
			),
		"RESULT_NOT_READY",
	);
});

test("empty verified observations retain no_data/null and no comparison is rejected", async () => {
	const empty = await exportFixture(db, storage, {
		withoutComparison: true,
		skipLocation: true,
		mutatePage(page) {
			page.observations = [];
		},
		mutateResult(result) {
			for (const item of [result.primary, ...result.months])
				item.metric = {
					rawCount: null,
					harmonizedCount: null,
					rawCountsBySource: Object.fromEntries(
						result.sources.map((s) => [s.id, null]),
					),
					status: "no_data",
				};
		},
	});
	const input = { ...body(), analysisId: empty.analysisId };
	await rejects(
		() =>
			api.createResearchExport(
				empty.dependencies,
				empty.workspace,
				empty.user,
				{ ...input, periodRole: "comparison" },
			),
		"INVALID_REQUEST",
	);
	const created = await api.createResearchExport(
		empty.dependencies,
		empty.workspace,
		empty.user,
		input,
	);
	await run();
	const manifest = await api.getResearchExportManifest(
		empty.dependencies,
		empty.workspace,
		empty.user,
		created.value.id,
	);
	assert.equal(manifest.csv.rowCount, 0);
	assert.equal(manifest.summary.metric.rawCount, null);
	assert.equal(manifest.summary.metric.status, "no_data");
});

test("known analysis lease UUIDs cannot leak through case-varied inspection notes", async () => {
	const a = await assignments.createInspectionAssignment(
		db,
		f.workspace,
		f.user,
		f.location.id,
		{ requestId: randomUUID(), assigneeUserId: f.user },
	);
	await reports.createResearchReport(db, f.workspace, f.user, a.id, {
		requestId: randomUUID(),
		inspectorUserId: f.user,
		observedAt: "2026-08-01T00:00:00Z",
		outcome: "inconclusive",
		notes: f.fixture.attempt.leaseToken.toUpperCase(),
	});
	await rejects(() => create(), "DEPENDENCY_UNAVAILABLE");
	assert.equal((await rows("ResearchExport")).length, 0);
});

test("credential changes are scanned again before either artifact is sent", async () => {
	const created = await create(body({ kind: "harmonized-aggregates-csv" }));
	await run();
	const previous = process.env.RESEARCH_EXPORT_DSN;
	process.env.RESEARCH_EXPORT_DSN = `postgresql://isolated-export-user:${encodeURIComponent(f.fixture.result.payload.dataVersion)}@127.0.0.1/test`;
	try {
		await rejects(
			() =>
				api.getResearchExportDownload(
					f.dependencies,
					f.workspace,
					f.user,
					created.value.id,
				),
			"DEPENDENCY_UNAVAILABLE",
		);
		await rejects(
			() =>
				api.getResearchExportManifest(
					f.dependencies,
					f.workspace,
					f.user,
					created.value.id,
				),
			"DEPENDENCY_UNAVAILABLE",
		);
	} finally {
		if (previous === undefined) delete process.env.RESEARCH_EXPORT_DSN;
		else process.env.RESEARCH_EXPORT_DSN = previous;
	}
});

test("newly configured secrets are scanned as decoded CSV cells after quoting", async () => {
	const secret = 'synthetic"credential';
	const source = await exportFixture(db, storage, {
		skipLocation: true,
		mutatePage(page) {
			page.observations[0].confidence = secret;
		},
	});
	const created = await api.createResearchExport(
		source.dependencies,
		source.workspace,
		source.user,
		{ ...body(), analysisId: source.analysisId },
	);
	await run();
	const previous = process.env.AUTH_SECRET;
	process.env.AUTH_SECRET = secret;
	try {
		await rejects(
			() =>
				api.getResearchExportDownload(
					source.dependencies,
					source.workspace,
					source.user,
					created.value.id,
				),
			"DEPENDENCY_UNAVAILABLE",
		);
		await rejects(
			() =>
				api.getResearchExportManifest(
					source.dependencies,
					source.workspace,
					source.user,
					created.value.id,
				),
			"DEPENDENCY_UNAVAILABLE",
		);
	} finally {
		if (previous === undefined) delete process.env.AUTH_SECRET;
		else process.env.AUTH_SECRET = previous;
	}
});

test("two claims never own the same export concurrently", async () => {
	await create();
	const claims = await Promise.all([
		exportQueue.claimResearchExport(db),
		exportQueue.claimResearchExport(db),
	]);
	assert.equal(claims.filter(Boolean).length, 1);
});
