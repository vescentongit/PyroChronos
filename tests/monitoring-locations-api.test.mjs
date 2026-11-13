import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { applyResearchMigrations } from "./helpers/research-publication-fixtures.mjs";
import {
	publishedFixture,
	sqlAdapter,
	Storage,
} from "./helpers/monitoring-location-fixtures.mjs";

const hook = registerHooks({
	resolve(specifier, context, next) {
		return next(
			context.parentURL?.includes("/src/lib/") &&
				specifier.startsWith("./") &&
				!specifier.endsWith(".ts")
				? `${specifier}.ts`
				: specifier,
			context,
		);
	},
});
let createMonitoringLocationHandlers, ResearchFailure;
try {
	({ createMonitoringLocationHandlers } = await import(
		"../src/lib/monitoring-locations-http.ts"
	));
	({ ResearchFailure } = await import("../src/lib/research-store.ts"));
} finally {
	hook.deregister();
}

let pg,
	root,
	db,
	storage,
	evidence,
	handlers,
	dependencies,
	sequence = 0;
before(async () => {
	pg = await PGlite.create();
	root = await mkdtemp(path.join(tmpdir(), "locations-api-"));
});
after(async () => {
	await pg?.close();
	if (root) await rm(root, { recursive: true, force: true });
});
beforeEach(async () => {
	await pg.exec(
		`CREATE SCHEMA locations_api_${++sequence}; SET search_path TO locations_api_${sequence}, public`,
	);
	await applyResearchMigrations(pg);
	db = sqlAdapter(pg);
	storage = new Storage(path.join(root, String(sequence)));
	evidence = await publishedFixture(db, storage);
	dependencies = {
		session: async () => ({ user: { id: evidence.user } }),
		database: () => db,
		artifacts: () => storage,
		enabled: () => true,
	};
	handlers = createMonitoringLocationHandlers(dependencies);
});
const context = (locationId) => ({
	params: Promise.resolve({
		workspaceId: evidence.workspace,
		...(locationId ? { locationId } : {}),
	}),
});
const request = (method = "GET", body, query = "") =>
	new Request(
		`http://localhost/api/v2/workspaces/${evidence.workspace}/locations${query}`,
		{
			method,
			...(body === undefined
				? {}
				: {
						body: JSON.stringify(body),
						headers: { "Content-Type": "application/json" },
					}),
		},
	);
const privateResponse = (response, status) => {
	assert.equal(response.status, status);
	assert.equal(response.headers.get("cache-control"), "private, no-store");
};

test("POST, GET collection and GET detail return contract locations with private headers", async () => {
	const response = await handlers.POST(
		request("POST", evidence.body),
		context(),
	);
	privateResponse(response, 201);
	const created = await response.json();
	assert.deepEqual(created.anchor, evidence.observation);
	const detail = await handlers.detailGET(request(), context(created.id));
	privateResponse(detail, 200);
	assert.deepEqual(await detail.json(), created);
	const list = await handlers.GET(request(), context());
	privateResponse(list, 200);
	assert.deepEqual(await list.json(), { items: [created], nextCursor: null });
});

test("unauthenticated sessions and disabled API fail before database or storage access", async () => {
	for (const [overrides, status, code] of [
		[{ session: async () => null }, 401, "UNAUTHENTICATED"],
		[{ session: async () => ({ user: {} }) }, 401, "UNAUTHENTICATED"],
		[{ enabled: () => false }, 503, "DEPENDENCY_UNAVAILABLE"],
	]) {
		const protectedHandlers = createMonitoringLocationHandlers({
			...dependencies,
			...overrides,
			database: () => {
				throw new Error("secret-database-access");
			},
		});
		for (const [method, req, ctx] of [
			["GET", request(), context()],
			["POST", request("POST", evidence.body), context()],
			["detailGET", request(), context("missing")],
		]) {
			const response = await protectedHandlers[method](req, ctx);
			privateResponse(response, status);
			assert.equal((await response.json()).code, code);
		}
	}
});

test("forbidden membership and unknown locations return safe errors", async () => {
	const outsider = createMonitoringLocationHandlers({
		...dependencies,
		session: async () => ({ user: { id: "outsider" } }),
	});
	const denied = await outsider.POST(request("POST", evidence.body), context());
	privateResponse(denied, 403);
	assert.equal((await denied.json()).code, "FORBIDDEN");
	const missing = await handlers.detailGET(request(), context("missing"));
	privateResponse(missing, 404);
	assert.equal((await missing.json()).code, "NOT_FOUND");
});

test("strict body, malformed JSON, invalid pagination and foreign origins are rejected", async () => {
	for (const req of [
		request("POST", { ...evidence.body, coordinates: [0, 0] }),
		new Request("http://localhost/api/v2/locations", {
			method: "POST",
			body: "{",
		}),
	]) {
		const response = await handlers.POST(req, context());
		privateResponse(response, 400);
		assert.equal((await response.json()).code, "INVALID_REQUEST");
	}
	for (const query of [
		"?limit=101",
		"?limit=0",
		"?limit=1.5",
		"?cursor=broken",
		"?limit=",
		"?limit=2&limit=3",
	])
		privateResponse(
			await handlers.GET(request("GET", undefined, query), context()),
			400,
		);
	const foreign = request("POST", evidence.body);
	foreign.headers.set("Origin", "https://foreign.invalid");
	privateResponse(await handlers.POST(foreign, context()), 403);
});

test("HTTP retries reuse a location and conflicting payload returns 409", async () => {
	const first = await handlers.POST(request("POST", evidence.body), context());
	const retry = await handlers.POST(request("POST", evidence.body), context());
	privateResponse(retry, 201);
	assert.deepEqual(await retry.json(), await first.json());
	const conflict = await handlers.POST(
		request("POST", { ...evidence.body, name: "Different name" }),
		context(),
	);
	privateResponse(conflict, 409);
	assert.equal((await conflict.json()).code, "IDEMPOTENCY_CONFLICT");
});

test("untrusted database errors and forged error codes cannot leak secrets or stack traces", async () => {
	for (const error of [
		new Error("postgresql://user:private-sentinel@host/db"),
		new ResearchFailure("private-sentinel", 500),
	]) {
		const failing = createMonitoringLocationHandlers({
			...dependencies,
			database: () => {
				throw error;
			},
		});
		const response = await failing.GET(request(), context());
		privateResponse(response, 500);
		const body = await response.text();
		assert.equal(JSON.parse(body).code, "INTERNAL_ERROR");
		assert.doesNotMatch(body, /private-sentinel|postgresql|stack|at .*\.ts/);
	}
});

test("stored reads do not initialize artifact storage; missing storage fails create safely", async () => {
	const created = await (
		await handlers.POST(request("POST", evidence.body), context())
	).json();
	const unavailable = createMonitoringLocationHandlers({
		...dependencies,
		artifacts: () => {
			throw new Error("private-storage-path-sentinel");
		},
	});
	privateResponse(await unavailable.GET(request(), context()), 200);
	privateResponse(
		await unavailable.detailGET(request(), context(created.id)),
		200,
	);
	privateResponse(
		await unavailable.POST(
			request("POST", {
				...evidence.body,
				requestId: "11111111-1111-4111-8111-111111111111",
			}),
			context(),
		),
		503,
	);
});
