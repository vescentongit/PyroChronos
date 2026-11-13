import assert from "node:assert/strict";
import { test } from "node:test";
import { loadInspectionModule } from "./helpers/research-inspection-fixtures.mjs";
const { createResearchAnalysisHandlers } = await loadInspectionModule(
	"research-analyses-http",
);
const context = {
	params: Promise.resolve({
		workspaceId: "private-workspace",
		analysisId: "private-result",
	}),
};
const request = () =>
	new Request(
		"http://localhost/api/v2/workspaces/private-workspace/analyses/private-result",
	);
for (const [name, status, deps] of [
	["unauthenticated", 401, { enabled: () => true, session: async () => null }],
	["disabled", 503, { enabled: () => false, session: async () => null }],
	[
		"unsafe dependency errors",
		500,
		{ enabled: () => true, session: async () => ({ user: { id: "member" } }) },
	],
])
	test(`P1 analysis HTTP ${name} returns a private safe error`, async () => {
		const handlers = createResearchAnalysisHandlers({
			...deps,
			database: () => {
				throw new Error(
					"postgresql://synthetic:private-password@invalid/database",
				);
			},
			artifacts: () => {
				throw new Error("private storage sentinel");
			},
		});
		const response = await handlers.resultGET(request(), context);
		assert.equal(response.status, status);
		assert.equal(response.headers.get("cache-control"), "private, no-store");
		assert.doesNotMatch(
			await response.text(),
			/postgresql|password|stack|sentinel/,
		);
	});
