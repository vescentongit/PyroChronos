import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { researchExportManifestSchema } from "../src/lib/research-export-contracts.ts";
import { assertExportSafe } from "../src/lib/research-export-manifest.ts";
import { assertExportCsvSafe } from "../src/lib/research-export-security.ts";

const example = () =>
	JSON.parse(
		readFileSync(
			new URL(
				"../docs/contracts/research-export-manifest.examples.json",
				import.meta.url,
			),
		),
	).manifest;
test("protected manifest rejects private fields and foreign or inconsistent inspection references", () => {
	const valid = example();
	assert.ok(researchExportManifestSchema.safeParse(valid).success);
	const foreign = example();
	foreign.inspectionContext.reports[0].workspaceId = "foreign-workspace";
	assert.equal(researchExportManifestSchema.safeParse(foreign).success, false);
	const allForeign = example();
	for (const group of Object.values(allForeign.inspectionContext))
		for (const record of group) record.workspaceId = "foreign-workspace";
	assert.equal(
		researchExportManifestSchema.safeParse(allForeign).success,
		false,
	);
	const orphan = example();
	orphan.inspectionContext.assignments = [];
	assert.equal(researchExportManifestSchema.safeParse(orphan).success, false);
	for (const additional of [
		{ leaseToken: "private-token" },
		{ objectKey: "private/path" },
		{ payloadRef: "https://private.invalid" },
	])
		assert.equal(
			researchExportManifestSchema.safeParse({ ...example(), ...additional })
				.success,
			false,
		);
});

test("every known analysis/export lease token is scanned case-insensitively", async () => {
	const analysis = "abcdefab-abcd-4abc-8abc-abcdefabcdef",
		exported = "fedcbafe-abcd-4abc-8abc-fedcbafedcba";
	const db = { query: async () => [{ token: analysis }, { token: exported }] };
	const row = {
		id: "export",
		analysisId: "analysis",
		workspaceId: "workspace",
	};
	for (const token of [
		analysis.toUpperCase(),
		exported.toUpperCase(),
		"aBcDeFaB-AbCd-4aBc-8AbC-aBcDeFaBcDeF",
	])
		await assert.rejects(
			assertExportSafe(db, row, { archiveRevision: token }),
			(error) => error.code === "DEPENDENCY_UNAVAILABLE",
		);
});

test("filesystem paths and private object references cannot masquerade as archive revisions", async () => {
	const row = {
		id: "export",
		analysisId: "analysis",
		workspaceId: "workspace",
	};
	for (const path of [
		"C:/private-research-artifacts/internal/batches/raw.json",
		"c:\\private\\raw.json",
		"/srv/private/raw.json",
		"file:///private/raw.json",
		"\\\\private-server\\share\\raw.json",
		`exports/${"a".repeat(64)}/data.csv`,
	]) {
		const value = example();
		value.provenance.sourceSnapshots[0].archiveRevision = path;
		assert.equal(researchExportManifestSchema.safeParse(value).success, false);
		await assert.rejects(
			assertExportSafe({ query: async () => [] }, row, value),
			(error) => error.code === "DEPENDENCY_UNAVAILABLE",
		);
	}
});

test("encoded/decoded DSN credentials and JSON-escaped secrets cannot enter the manifest", async () => {
	const previous = process.env.EXPORT_DATABASE_DSN;
	const username = "isolated/export-user",
		password = 'private/DSN:"sentinel';
	process.env.EXPORT_DATABASE_DSN = `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@127.0.0.1/test`;
	try {
		for (const value of [
			username,
			password,
			encodeURIComponent(username),
			encodeURIComponent(password),
		])
			await assert.rejects(
				assertExportSafe(
					{ query: async () => [] },
					{ id: "export", analysisId: "analysis", workspaceId: "workspace" },
					{ source: { archiveRevision: value } },
				),
				(error) => error.code === "DEPENDENCY_UNAVAILABLE",
			);
	} finally {
		if (previous === undefined) delete process.env.EXPORT_DATABASE_DSN;
		else process.env.EXPORT_DATABASE_DSN = previous;
	}
});

test("OAuth and other configured secret variables are included in export scanning", async () => {
	const previous = process.env.AUTH_GOOGLE_SECRET;
	process.env.AUTH_GOOGLE_SECRET = "private-oauth-export-sentinel";
	try {
		await assert.rejects(
			assertExportSafe(
				{ query: async () => [] },
				{ id: "export", analysisId: "analysis", workspaceId: "workspace" },
				{ archiveRevision: process.env.AUTH_GOOGLE_SECRET },
			),
			(error) => error.code === "DEPENDENCY_UNAVAILABLE",
		);
	} finally {
		if (previous === undefined) delete process.env.AUTH_GOOGLE_SECRET;
		else process.env.AUTH_GOOGLE_SECRET = previous;
	}
});

test("CSV verification counts decoded records rather than physical newline characters", async () => {
	const bytes = Buffer.from('id,value\none,"multi\nline"\n');
	await assertExportCsvSafe(bytes, [], 1);
	await assert.rejects(
		assertExportCsvSafe(bytes, [], 2),
		(error) => error.code === "DEPENDENCY_UNAVAILABLE",
	);
});
