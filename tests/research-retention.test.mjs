import assert from "node:assert/strict";
import { test } from "node:test";
import { serverResearchRetentionPolicy } from "../src/lib/research-retention.ts";
test("archive policy has no destructive TTL or orphan deletion", () => {
	assert.equal(serverResearchRetentionPolicy.historyTtlDays, null);
	assert.equal(serverResearchRetentionPolicy.artifactTtlDays, null);
	assert.equal(serverResearchRetentionPolicy.automaticDeletion, false);
	assert.equal(serverResearchRetentionPolicy.overwriteValidArtifacts, false);
	assert.equal(
		serverResearchRetentionPolicy.orphanDisposition,
		"retain-private-for-review",
	);
});
