import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { applyResearchMigrations } from "./helpers/research-publication-fixtures.mjs";
import {
	exportFixture,
	exportWorker,
	loadInspectionModule,
	Storage,
	sqlAdapter,
} from "./helpers/research-export-fixtures.mjs";

const { createResearchExportHandlers } = await loadInspectionModule(
	"research-exports-http",
);
let pg,
	root,
	db,
	storage,
	f,
	dependencies,
	handlers,
	sequence = 0;
before(async () => {
	pg = await PGlite.create();
	root = await mkdtemp(path.join(tmpdir(), "exports-api-"));
});
after(async () => {
	await pg?.close();
	if (root) await rm(root, { recursive: true, force: true });
});
beforeEach(async () => {
	await pg.exec(
		`CREATE SCHEMA exports_api_${++sequence}; SET search_path TO exports_api_${sequence}, public`,
	);
	await applyResearchMigrations(pg);
	db = sqlAdapter(pg);
	storage = new Storage(path.join(root, String(sequence)));
	f = await exportFixture(db, storage);
	dependencies = {
		session: async () => ({ user: { id: f.user } }),
		database: () => db,
		storage: () => storage,
		enabled: () => true,
	};
	handlers = createResearchExportHandlers(dependencies);
});
const body = (changes = {}) => ({
	requestId: randomUUID(),
	analysisId: f.analysisId,
	periodRole: "primary",
	kind: "raw-hotspots-csv",
	...changes,
});
const request = (method = "GET", payload) =>
	new Request("http://localhost/api/v2/exports", {
		method,
		...(payload
			? {
					body: JSON.stringify(payload),
					headers: { "Content-Type": "application/json" },
				}
			: {}),
	});
const context = (exportId) => ({
	params: Promise.resolve({ workspaceId: f.workspace, exportId }),
});
const check = async (response, status, code) => {
	assert.equal(response.status, status);
	assert.equal(response.headers.get("cache-control"), "private, no-store");
	const value = await response.json();
	if (code) assert.equal(value.code, code);
	return value;
};

test("export creation, status, CSV stream and manifest remain private and contract-shaped", async () => {
	const created = await check(
		await handlers.POST(request("POST", body()), context()),
		202,
	);
	await check(
		await handlers.downloadGET(request(), context(created.id)),
		409,
		"RESULT_NOT_READY",
	);
	await exportWorker.runResearchExportOnce(f.dependencies);
	const status = await check(
		await handlers.GET(request(), context(created.id)),
		200,
	);
	assert.equal(status.status, "ready");
	const file = await handlers.downloadGET(request(), context(created.id));
	assert.equal(file.status, 200);
	assert.equal(file.headers.get("cache-control"), "private, no-store");
	assert.match(file.headers.get("content-type"), /text\/csv/);
	assert.match(
		file.headers.get("content-disposition"),
		/^attachment; filename="[a-z0-9_-]+\.csv"$/,
	);
	assert.equal(file.headers.get("location"), null);
	assert.match(await file.text(), /detection-demo/);
	const manifest = await check(
		await handlers.manifestGET(request(), context(created.id)),
		200,
	);
	assert.equal(manifest.schemaVersion, "research-export-manifest-1");
	assert.equal(
		(await check(await handlers.POST(request("POST", body()), context()), 200))
			.id,
		created.id,
	);
});

test("strict input, conflicting retries and foreign origins produce bounded safe errors", async () => {
	const input = body();
	await handlers.POST(request("POST", input), context());
	await check(
		await handlers.POST(
			request("POST", { ...input, kind: "harmonized-aggregates-csv" }),
			context(),
		),
		409,
		"IDEMPOTENCY_CONFLICT",
	);
	await check(
		await handlers.POST(
			request("POST", { ...body(), downloadPath: "https://private.invalid" }),
			context(),
		),
		400,
		"INVALID_REQUEST",
	);
	const foreign = request("POST", body());
	foreign.headers.set("Origin", "https://foreign.invalid");
	await check(await handlers.POST(foreign, context()), 403, "FORBIDDEN");
	await check(
		await handlers.POST(
			new Request("http://localhost/", { method: "POST", body: "{" }),
			context(),
		),
		400,
		"INVALID_REQUEST",
	);
});

test("every operation rechecks session and active workspace membership", async () => {
	const created = await check(
		await handlers.POST(request("POST", body()), context()),
		202,
	);
	await exportWorker.runResearchExportOnce(f.dependencies);
	for (const [overrides, status, code] of [
		[{ session: async () => null }, 401, "UNAUTHENTICATED"],
		[{ enabled: () => false }, 503, "DEPENDENCY_UNAVAILABLE"],
		[{ session: async () => ({ user: { id: "outsider" } }) }, 403, "FORBIDDEN"],
	]) {
		const h = createResearchExportHandlers({ ...dependencies, ...overrides });
		for (const method of ["GET", "downloadGET", "manifestGET"])
			await check(
				await h[method](request(), context(created.id)),
				status,
				code,
			);
		await check(await h.POST(request("POST", body()), context()), status, code);
	}
});

test("database exceptions never appear in status or download error bodies", async () => {
	const h = createResearchExportHandlers({
		...dependencies,
		database: () => {
			throw new Error("postgresql://user:private-sentinel@host/db");
		},
	});
	for (const method of ["GET", "downloadGET", "manifestGET"]) {
		const value = await check(
			await h[method](request(), context("missing")),
			500,
			"INTERNAL_ERROR",
		);
		assert.doesNotMatch(
			JSON.stringify(value),
			/private-sentinel|postgresql|stack/,
		);
	}
});
