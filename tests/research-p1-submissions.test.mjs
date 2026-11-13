import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { applyResearchMigrations } from "./helpers/research-publication-fixtures.mjs";
import { loadInspectionModule } from "./helpers/research-inspection-fixtures.mjs";
import { sqlAdapter } from "./helpers/monitoring-location-fixtures.mjs";
import { foundationFixture } from "./helpers/research-foundation-fixtures.mjs";
const store = await loadInspectionModule("research-store");
const { p1JobWire } = await loadInspectionModule(
	"research-analysis-submissions",
);
let pg, db, area;
before(async () => {
	pg = await PGlite.create();
	await applyResearchMigrations(pg);
	db = sqlAdapter(pg);
	await db.query(
		"INSERT INTO \"User\" (id,name) VALUES ('p1-user','Synthetic')",
	);
	await db.query(
		"INSERT INTO \"Workspace\" (id,name,\"createdById\") VALUES ('p1-workspace','Synthetic','p1-user')",
	);
	await db.query(
		"INSERT INTO \"Membership\" (\"workspaceId\",\"userId\",role) VALUES ('p1-workspace','p1-user','owner')",
	);
	area = await store.createArea(db, "p1-workspace", {
		name: "Synthetic polygon",
		geometry: {
			type: "Polygon",
			coordinates: [
				[
					[113, -3.6],
					[115, -3.6],
					[115, -1.5],
					[113, -1.5],
					[113, -3.6],
				],
			],
		},
	});
	await db.query(
		"INSERT INTO \"ResearchDataset\" (id,config) VALUES ('legacy-dataset',$1::jsonb)",
		[
			JSON.stringify({
				qualityPolicyVersion: "quality-policy-1",
				fingerprint: `sha256:${"a".repeat(64)}`,
			}),
		],
	);
});
after(async () => pg?.close());
test("failed P1 jobs preserve bounded non-retryable error semantics", () => {
	const f = foundationFixture();
	const job = {
		...f.job,
		status: "failed",
		completedAt: f.result.publishedAt,
		resultId: null,
		error: {
			schemaVersion: "research-2",
			code: "INTERNAL_ERROR",
			error: "Synthetic failure",
			retryable: false,
			requestId: null,
		},
	};
	assert.equal(p1JobWire(job).error.retryable, false);
});
test("active submission selects the P1 stack and rejects missing versioned producer configuration", async () => {
	await assert.rejects(
		() =>
			store.submitAnalysis(db, "p1-workspace", "p1-user", {
				requestId: randomUUID(),
				areaId: area.id,
				areaRevision: 1,
				period: { start: "2019-09-01", end: "2019-09-30" },
				comparisonPeriod: null,
				baseline: { kind: "rolling-same-calendar-period", windowYears: 10 },
				referenceScale: "MODIS-equivalent",
				qualityPolicyVersion: "quality-policy-1",
				monitoringLocationId: null,
			}),
		(error) => error.code === "DEPENDENCY_UNAVAILABLE",
	);
	assert.equal((await db.query('SELECT * FROM "AnalysisRun"')).length, 0);
});
