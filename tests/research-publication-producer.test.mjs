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
let bindResearchProducer;
try {
	({ bindResearchProducer } = await import(
		"../src/lib/research-publication-producer.ts"
	));
} finally {
	hook.deregister();
}

test("producer binding refuses a result without observation evidence", () => {
	const f = foundationFixture();
	const context = { job: f.job, attempt: f.attempt, now: f.result.publishedAt };
	for (const artifacts of [[], [{ ...f.artifacts[0], kind: "daily" }]]) {
		assert.throws(
			() =>
				bindResearchProducer(
					{ result: f.result.payload, manifest: f.manifest },
					context,
					artifacts,
					f.result.generatedAt,
					f.result.publishedAt,
				),
			(error) => error.code === "INVALID_OUTPUT",
		);
	}
});
