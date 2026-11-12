import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { foundationFixture } from "./helpers/research-foundation-fixtures.mjs";

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
let findOriginalObservation, publicationChecksum;
try {
	({ findOriginalObservation } = await import(
		"../src/lib/monitoring-location-evidence.ts"
	));
	({ publicationChecksum } = await import(
		"../src/lib/research-publication-values.ts"
	));
} finally {
	hook.deregister();
}

function fixture() {
	const f = foundationFixture();
	const result = f.result.payload;
	const anchor = f.location.anchor;
	const page = {
		schemaVersion: "research-2",
		analysisId: result.id,
		periodRole: "primary",
		observations: [anchor],
		nextCursor: null,
	};
	return { f, result, anchor, page };
}
function lookup(document, options = {}) {
	const { f, result, anchor } = fixture();
	const bytes = Buffer.from(JSON.stringify(document));
	const metadata = {
		...f.artifacts[0],
		format: "json",
		bytes: bytes.byteLength,
		checksum: publicationChecksum(bytes),
		...options.metadata,
	};
	const database = { query: async () => options.rows ?? [metadata] };
	const reader = { read: async () => options.bytes ?? bytes };
	return () => findOriginalObservation(database, reader, result, anchor.id);
}
const unavailable = (run) =>
	assert.rejects(
		run,
		(error) =>
			error.code === "DEPENDENCY_UNAVAILABLE" &&
			!error.message.includes("sentinel"),
	);

test("verified JSON pages and page partitions preserve the exact observation", async () => {
	const { page, anchor } = fixture();
	assert.deepEqual(await lookup(page)(), anchor);
	assert.deepEqual(await lookup([page, structuredClone(page)])(), anchor);
});
test("conflicting snapshots for one detection ID are never chosen arbitrarily", async () => {
	const { page } = fixture();
	const conflicting = structuredClone(page);
	conflicting.observations[0].frpMw = 99;
	await unavailable(lookup([page, conflicting]));
});
test("missing, excessive and unsupported artifact sets fail closed", async () => {
	const { page } = fixture();
	for (const options of [
		{ rows: [] },
		{ rows: Array(129).fill({}) },
		{ metadata: { format: "parquet" } },
		{ metadata: { format: "geojson" } },
		{ metadata: { bytes: 64 * 1024 * 1024 + 1 } },
	])
		await unavailable(lookup(page, options));
});
test("size and checksum are checked even for a custom reader", async () => {
	const { page } = fixture();
	const bytes = Buffer.from(JSON.stringify(page));
	await unavailable(lookup(page, { bytes: Buffer.alloc(bytes.length, 32) }));
	await unavailable(lookup(page, { bytes: Buffer.from("short") }));
});
test("malformed and invented observation documents cannot supply an anchor", async () => {
	const { page } = fixture();
	for (const document of [
		{ coordinates: [0, 0] },
		{ ...page, observations: [{ ...page.observations[0], cluster: true }] },
		{
			...page,
			observations: [{ ...page.observations[0], coordinates: [200, 100] }],
		},
	])
		await unavailable(lookup(document));
	const empty = { ...page, observations: [] };
	await assert.rejects(lookup(empty), (error) => error.code === "NOT_FOUND");
});
