// Explicit non-destructive archive policy. A finite TTL requires a separate
// approved migration/retention design; history triggers remain authoritative.
export const serverResearchRetentionPolicy = Object.freeze({
	version: "research-retention-1",
	historyTtlDays: null,
	artifactTtlDays: null,
	orphanDisposition: "retain-private-for-review",
	automaticDeletion: false,
	overwriteValidArtifacts: false,
});
