import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createAnonymousAdmission,
	capacityPolicy,
} from "../src/lib/research-capacity.ts";
import { loadInspectionModule } from "./helpers/research-inspection-fixtures.mjs";
const { withPrivateResearchRequest, researchRequestBody } =
	await loadInspectionModule("research-http");
const { fail } = await loadInspectionModule("research-store");

test("response authorization is checked again after work and before returning private bytes", async () => {
	const response = await withPrivateResearchRequest(
		new Request("http://localhost"),
		{
			enabled: () => true,
			session: async () => ({ user: { id: "revoked" } }),
			authorizeResponse: async () => fail("FORBIDDEN", 403),
		},
		async () => Response.json({ private: "must not escape" }),
	);
	assert.equal(response.status, 403);
	assert.doesNotMatch(await response.text(), /must not escape/);
});
const { boundExportStream, storeBoundedExport } = await loadInspectionModule(
	"research-export-worker",
);
const { FileResearchArtifactStorage } = await loadInspectionModule(
	"research-publication-storage",
);

test("real storage cleans partial overflow and preserves terminal capacity classification", async () => {
	const root = await mkdtemp(join(tmpdir(), "export-capacity-"));
	try {
		const storage = new FileResearchArtifactStorage(root);
		async function* bytes() {
			yield new Uint8Array(10);
			yield new Uint8Array(10);
		}
		await assert.rejects(
			storeBoundedExport(storage, "files/overflow.csv", bytes(), 15),
			(error) => error.code === "CAPACITY_LIMIT",
		);
		assert.deepEqual(await readdir(join(root, "files")), []);
		assert.equal(
			(await storeBoundedExport(storage, "files/ok.csv", bytes(), 20)).bytes,
			20,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("export stream rejects overflow and closes its source instead of truncating", async () => {
	let closed = false;
	async function* source() {
		try {
			yield new Uint8Array(10);
			yield new Uint8Array(10);
		} finally {
			closed = true;
		}
	}
	await assert.rejects(
		async () => {
			for await (const _ of boundExportStream(source(), 15)) {
			}
		},
		(error) => error.code === "CAPACITY_LIMIT",
	);
	assert.equal(closed, true);
	let bytes = 0;
	for await (const part of boundExportStream(source(), 20))
		bytes += part.byteLength;
	assert.equal(bytes, 20);
});

test("anonymous quota is process-scoped, bounded, and releases capacity without erasing quota", () => {
	let now = 0;
	const gate = createAnonymousAdmission(() => now);
	const first = gate.acquire();
	assert.equal(typeof first.release, "function");
	assert.equal(gate.acquire().code, "CAPACITY_LIMIT");
	first.release();
	first.release();
	for (let i = 1; i < capacityPolicy.requestsPerMinute; i++)
		gate.acquire().release();
	assert.equal(gate.acquire().code, "RATE_LIMITED");
	now = 60_000;
	assert.equal(typeof gate.acquire().release, "function");
});

test("legacy errors distinguish retry backoff from permanent payload rejection", async () => {
	for (const [code, status, retry] of [
		["CAPACITY_LIMIT", 503, "2"],
		["RATE_LIMITED", 429, "60"],
		["PAYLOAD_TOO_LARGE", 413, null],
	]) {
		const response = await withPrivateResearchRequest(
			new Request("http://localhost"),
			{ enabled: () => true, session: async () => ({ user: { id: "user" } }) },
			async () => fail(code, status),
		);
		assert.equal(response.status, status);
		assert.equal(response.headers.get("Retry-After"), retry);
		const body = await response.json();
		assert.equal(body.code, code);
		assert.equal(body.retryable, status !== 413);
	}
});

test("legacy JSON reader bounds declared and streamed bytes before parsing", async () => {
	for (const headers of [{ "content-length": "100001" }, {}]) {
		const request = new Request("http://localhost", {
			method: "POST",
			headers,
			body: JSON.stringify({ large: "x".repeat(100_000) }),
		});
		await assert.rejects(
			researchRequestBody(request),
			(error) => error.code === "PAYLOAD_TOO_LARGE",
		);
	}
});
