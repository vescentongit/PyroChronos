import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";

registerHooks({
	resolve(s, c, n) {
		return n(
			c.parentURL?.includes("/src/lib/") &&
				s.startsWith("./") &&
				!s.endsWith(".ts")
				? `${s}.ts`
				: s,
			c,
		);
	},
});
const { recoverLocalResearch } = await import(
	"../src/lib/local-research-client.ts"
);
test("repeated browser index recovery retains bundles, bad records and damaged history backup", async () => {
	const example = JSON.parse(
		readFileSync("src/lib/fixtures/research-demo.json", "utf8"),
	);
	const values = [
		{ result: example.result, manifest: {}, days: [], detections: [] },
		{ broken: true },
		{
			result: { ...example.result, id: "incomplete-month-stage" },
			manifest: {},
			days: [],
			detections: [],
			localStageOnly: true,
		},
		{
			result: { ...example.result, id: "legacy-month-stage" },
			manifest: {},
			days: [],
			detections: [],
		},
	];
	const before = structuredClone(values);
	const local = new Map([
		["pyro-research-history-v1", "damaged original"],
		["pyro-stage-v1-legacy", "legacy-month-stage"],
	]);
	globalThis.localStorage = {
		get length() {
			return local.size;
		},
		key: (index) => [...local.keys()][index] ?? null,
		getItem: (k) => local.get(k) ?? null,
		setItem: (k, v) => local.set(k, v),
	};
	globalThis.indexedDB = {
		open() {
			const open = {
				result: {
					close() {},
					transaction() {
						const tx = {
							objectStore() {
								return {
									openCursor() {
										let i = 0;
										const cursor = {};
										const advance = () =>
											queueMicrotask(() => {
												cursor.result =
													i < values.length
														? { value: values[i++], continue: advance }
														: null;
												cursor.onsuccess();
												if (!cursor.result) tx.oncomplete();
											});
										advance();
										return cursor;
									},
								};
							},
						};
						return tx;
					},
				},
			};
			queueMicrotask(() => open.onsuccess());
			return open;
		},
	};
	assert.deepEqual(await recoverLocalResearch(), {
		valid: 1,
		invalidRetained: 1,
	});
	const repaired = structuredClone(local);
	assert.deepEqual(await recoverLocalResearch(), {
		valid: 1,
		invalidRetained: 1,
	});
	assert.deepEqual(local, repaired);
	assert.deepEqual(values, before);
	assert.equal(
		local.get("pyro-research-history-v1-recovery-backup"),
		"damaged original",
	);
	local.set("pyro-last-research-v1", "missing-result");
	await recoverLocalResearch();
	assert.equal(local.get("pyro-last-research-v1"), example.result.id);
	assert.equal(
		local.get("pyro-last-research-v1-recovery-backup"),
		"missing-result",
	);
	local.delete("pyro-last-research-v1");
	const set = globalThis.localStorage.setItem;
	globalThis.localStorage.setItem = (key, value) => {
		if (key === "pyro-last-research-v1")
			throw new Error("Synthetic quota failure");
		set(key, value);
	};
	await assert.rejects(recoverLocalResearch(), error => error.code === "STORAGE_UNAVAILABLE");
	assert.deepEqual(values, before);
	globalThis.localStorage.setItem = set;
	await recoverLocalResearch();
	assert.equal(local.get("pyro-last-research-v1"), example.result.id);
});
