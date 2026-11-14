import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { loadInspectionModule } from "./helpers/research-inspection-fixtures.mjs";
const { reconcileResearchObjects } =
	await loadInspectionModule("research-recovery");
test("whole-root restore is repeatable; damaged existing objects are never replaced", async () => {
	const dir = await mkdtemp(join(tmpdir(), "recovery-guard-"));
	try {
		const root = join(dir, "missing"),
			backup = join(dir, "backup"),
			content = Buffer.from("verified synthetic");
		await mkdir(join(backup, "research"), { recursive: true });
		await writeFile(join(backup, "research/file.json"), content);
		const rows = [
			{
				objectKey: "research/file.json",
				bytes: content.length,
				checksum:
					`sha256:${createHash("sha256").update(content).digest("hex")}`,
			},
		];
		const db = {
			query: async (sql) => {
				assert.match(sql, /^SELECT /);
				return rows;
			},
		};
		assert.equal(
			(await reconcileResearchObjects(db, root, backup))[0].status,
			"restored",
		);
		assert.equal(
			(await reconcileResearchObjects(db, root, backup))[0].status,
			"verified",
		);
		await writeFile(join(root, "research/file.json"), "damaged evidence");
		assert.equal(
			(await reconcileResearchObjects(db, root, backup))[0].status,
			"damaged-retained",
		);
		assert.equal(
			(await readFile(join(root, "research/file.json"))).toString(),
			"damaged evidence",
		);
		rows[0].objectKey = "../outside";
		await assert.rejects(
			reconcileResearchObjects(db, root, backup),
			/RECOVERY_METADATA_REJECTED/,
		);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
