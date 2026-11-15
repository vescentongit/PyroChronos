import { readdir, lstat, realpath, mkdir } from "node:fs/promises";
import { join, relative, resolve, dirname } from "node:path";
import { analysisArtifactSchema } from "./research-foundation-contracts.ts";
import { FileResearchArtifactStorage } from "./research-publication-storage.ts";

type Database = {
	query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
};
// No metadata writes or deletion: unreferenced files remain private, never auto-published.
export async function reconcileResearchObjects(
	db: Database,
	root: string,
	backupRoot?: string,
) {
	const storage = new FileResearchArtifactStorage(root);
	try {
		await realpath(root);
	} catch (error) {
		if (
			!backupRoot ||
			!(error instanceof Error && "code" in error && error.code === "ENOENT")
		)
			throw error;
		if (relative(resolve(dirname(root)), await realpath(dirname(root))) !== "")
			throw new Error("RECOVERY_ROOT_REJECTED");
		await mkdir(root, { mode: 0o700 });
	}
	if (relative(resolve(root), await realpath(root)) !== "")
		throw new Error("RECOVERY_ROOT_REJECTED");
	const backup = backupRoot
		? new FileResearchArtifactStorage(backupRoot)
		: undefined;
	const rows = await db.query(
		'SELECT "objectKey",checksum,bytes FROM "P1AnalysisArtifact" UNION ALL SELECT "objectKey",checksum,bytes FROM "ResearchExportArtifact"',
	);
	const referenced = new Set(rows.map((row) => String(row.objectKey)));
	const report: { key: string; status: string }[] = [];
	for (const row of rows) {
		const key = String(row.objectKey),
			checksum = String(row.checksum),
			bytes = Number(row.bytes);
		if (
			!analysisArtifactSchema.shape.objectKey.safeParse(key).success ||
			!/^sha256:[a-f0-9]{64}$/.test(checksum) ||
			!Number.isSafeInteger(bytes) ||
			bytes < 0
		)
			throw new Error("RECOVERY_METADATA_REJECTED");
		try {
			await storage.verify(key, checksum, bytes);
			report.push({ key, status: "verified" });
		} catch {
			// Restore only absent objects, never replace corrupted or existing objects.
			try {
				await lstat(join(root, key));
				report.push({ key, status: "damaged-retained" });
			} catch (error) {
				if (
					!(
						error instanceof Error &&
						"code" in error &&
						error.code === "ENOENT"
					)
				)
					throw error;
				if (!backup) {
					report.push({ key, status: "missing" });
					continue;
				}
				try {
					const content = await backup.read(key, checksum, bytes);
					await storage.put(key, content);
					await storage.verify(key, checksum, bytes);
					report.push({ key, status: "restored" });
				} catch {
					report.push({ key, status: "restore-unavailable" });
				}
			}
		}
	}
	async function walk(dir: string): Promise<void> {
		for (const entry of await readdir(dir, { withFileTypes: true })) {
			const file = join(dir, entry.name);
			if (entry.isSymbolicLink()) throw new Error("RECOVERY_SYMLINK_REJECTED");
			if (entry.isDirectory()) await walk(file);
			else if (entry.isFile()) {
				const key = relative(root, file).replaceAll("\\", "/");
				if (!referenced.has(key))
					report.push({ key, status: "unreferenced-retained" });
			}
		}
	}
	await walk(root);
	return report.sort((a, b) => a.key.localeCompare(b.key));
}
