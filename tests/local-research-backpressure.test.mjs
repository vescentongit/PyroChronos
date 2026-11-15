import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
registerHooks({
	resolve(specifier, context, next) {
		if (specifier.startsWith("@/"))
			return next(
				pathToFileURL(resolve("src", `${specifier.slice(2)}.ts`)).href,
				context,
			);
		return next(specifier, context);
	},
});
const { POST } = await import("../src/app/api/local-research/route.ts");
const call = (body) =>
	POST(
		new Request("http://localhost/api/local-research", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		}),
	);

test("anonymous busy/quota responses are structured and admission is released after failure", async (t) => {
	const previous = process.env.PIPELINE_URL;
	process.env.PIPELINE_URL = "http://internal.invalid/";
	let release, started;
	const waiting = new Promise((resolve) => {
		release = resolve;
	});
	const entered = new Promise((resolve) => {
		started = resolve;
	});
	let calls = 0;
	t.mock.method(globalThis, "fetch", async () => {
		calls++;
		started();
		await waiting;
		return Response.json("invalid-fingerprint");
	});
	try {
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
		const area = await (
			await call({
				action: "area",
				workspaceId: "local",
				area: { requestId: randomUUID(), name: "Synthetic", geometry },
			})
		).json();
		assert.deepEqual(area.geometry, geometry);
		const request = {
			requestId: randomUUID(),
			areaId: area.id,
			areaRevision: 1,
			period: { start: "2019-01-01", end: "2019-01-02" },
			comparisonPeriod: null,
			baseline: { kind: "rolling-same-calendar-period", windowYears: 10 },
			referenceScale: "MODIS-equivalent",
			qualityPolicyVersion: "quality-policy-1",
			monitoringLocationId: null,
		};
		const body = { action: "analyze", workspaceId: "local", area, request };
		const pending = call(body);
		await entered;
		const busy = await call(body);
		assert.equal(busy.status, 503);
		assert.equal(busy.headers.get("Retry-After"), "2");
		assert.deepEqual(await busy.json(), {
			schemaVersion: "research-2",
			error: "CAPACITY LIMIT",
			code: "CAPACITY_LIMIT",
			retryable: true,
			requestId: request.requestId,
		});
		assert.equal(calls, 1);
		release();
		assert.equal((await pending).status, 503);
		// Failed producer attempts count; busy rejections do not. Workspace IDs do not reset quota.
		for (let i = 1; i < 30; i++) {
			const response = await call({
				...body,
				workspaceId: `local-${i}`,
				area: { ...area, workspaceId: `local-${i}` },
			});
			assert.equal((await response.json()).code, "DEPENDENCY_UNAVAILABLE");
		}
		const limited = await call(body);
		assert.equal(limited.status, 429);
		assert.equal(limited.headers.get("Retry-After"), "60");
		assert.equal((await limited.json()).code, "RATE_LIMITED");
		assert.equal(calls, 30);
		// Area validation remains available with analysis quota exhausted.
		assert.equal(
			(
				await call({
					action: "area",
					workspaceId: "local",
					area: { requestId: randomUUID(), name: "Still valid", geometry },
				})
			).status,
			200,
		);
	} finally {
		release();
		if (previous === undefined) delete process.env.PIPELINE_URL;
		else process.env.PIPELINE_URL = previous;
	}
});
