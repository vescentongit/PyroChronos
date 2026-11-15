import assert from "node:assert/strict";
import { test } from "node:test";
import { researchProducerConfigSchema } from "../src/lib/research-producer-contracts.ts";
import { publicationChecksum } from "../src/lib/research-publication-values.ts";
test("frozen JSON model documents cannot hide OAuth secrets through JSON escaping", () => {
	const previous = process.env.AUTH_GOOGLE_SECRET;
	process.env.AUTH_GOOGLE_SECRET = 'synthetic-model-"private-secret';
	const model = JSON.stringify({ note: process.env.AUTH_GOOGLE_SECRET }),
		baseline = "{}",
		policyDocument = "{}";
	try {
		assert.equal(
			researchProducerConfigSchema.safeParse({
				schemaVersion: "research-producer-config-1",
				fingerprint: publicationChecksum("archive"),
				sources: ["MODIS_SP"],
				archives: { MODIS_SP: [] },
				producerVersion: "synthetic",
				buildCommit: "a".repeat(40),
				mode: "demo",
				modelVersion: "1",
				model,
				baseline,
				modelChecksum: publicationChecksum(model),
				baselineChecksum: publicationChecksum(baseline),
				policyChecksum: publicationChecksum(policyDocument),
				policyDocument,
				qualityPolicyVersion: "quality-policy-1",
				satelliteConfigVersion: "satellite-config-1",
				aggregationVersion: "pcd1",
				baselinePolicyVersion: "synthetic",
				minimumValidYears: 10,
			}).success,
			false,
		);
	} finally {
		if (previous === undefined) delete process.env.AUTH_GOOGLE_SECRET;
		else process.env.AUTH_GOOGLE_SECRET = previous;
	}
});
