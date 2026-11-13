import { FileResearchArtifactStorage } from "./research-publication-storage.ts";
import { publicationChecksum } from "./research-publication-values.ts";
import { fail } from "./research-store.ts";
import type { ResearchExportArtifact } from "./research-export-contracts.ts";

export interface ResearchExportStorage {
	put(key: string, bytes: Uint8Array): Promise<void>;
	putStream(
		key: string,
		bytes: AsyncIterable<Uint8Array>,
	): Promise<{ checksum: string; bytes: number }>;
	verify(key: string, checksum: string, bytes: number): Promise<void>;
	read(key: string, checksum: string, bytes: number): Promise<Uint8Array>;
}
export const privateResearchExportStorage = (
	root: string,
): ResearchExportStorage => new FileResearchArtifactStorage(root);
export async function readVerifiedExportObject(
	storage: ResearchExportStorage,
	artifact: ResearchExportArtifact,
): Promise<Uint8Array> {
	try {
		const content = await storage.read(
			artifact.objectKey,
			artifact.checksum,
			artifact.bytes,
		);
		if (
			content.byteLength !== artifact.bytes ||
			publicationChecksum(content) !== artifact.checksum
		)
			return fail("DEPENDENCY_UNAVAILABLE", 503);
		return content;
	} catch {
		return fail("DEPENDENCY_UNAVAILABLE", 503);
	}
}
