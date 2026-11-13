import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { analysisArtifactSchema } from "./research-foundation-contracts";
import {
	PublicationFailure,
	publicationFailure,
} from "./research-publication-values";

export interface PrivateResearchArtifactStorage {
	put(key: string, content: Uint8Array): Promise<void>;
	verify(key: string, checksum: string, bytes: number): Promise<void>;
}

export class FileResearchArtifactStorage
	implements PrivateResearchArtifactStorage
{
	readonly root: string;
	private readonly maxBytes: number;

	constructor(root: string, maxBytes = 64 * 1024 * 1024) {
		this.root = resolve(root);
		this.maxBytes = maxBytes;
		const webServed = ["public", ".next/static"].some((folder) => {
			const nested = relative(resolve(process.cwd(), folder), this.root);
			return nested === "" || (!nested.startsWith("..") && !isAbsolute(nested));
		});
		if (
			!isAbsolute(root) ||
			!Number.isSafeInteger(maxBytes) ||
			maxBytes <= 0 ||
			webServed
		)
			throw new PublicationFailure("STORAGE_FAILED");
	}

	private async target(key: string, create: boolean): Promise<string> {
		if (!analysisArtifactSchema.shape.objectKey.safeParse(key).success)
			throw new PublicationFailure("STORAGE_FAILED");
		if (create) await mkdir(this.root, { recursive: true, mode: 0o700 });
		if (relative(this.root, await realpath(this.root)) !== "")
			throw new PublicationFailure("STORAGE_FAILED");
		let parent = this.root;
		for (const part of key.split("/").slice(0, -1)) {
			parent = join(parent, part);
			if (create)
				await mkdir(parent, { mode: 0o700 }).catch((error: unknown) => {
					if (
						!(
							error instanceof Error &&
							"code" in error &&
							error.code === "EEXIST"
						)
					)
						throw error;
				});
			const info = await lstat(parent);
			if (!info.isDirectory() || info.isSymbolicLink())
				throw new PublicationFailure("STORAGE_FAILED");
		}
		return join(this.root, key);
	}

	async put(key: string, content: Uint8Array): Promise<void> {
		const copy = Uint8Array.from(content);
		await this.putStream(
			key,
			(async function* () {
				yield copy;
			})(),
		);
	}

	async putStream(
		key: string,
		source: AsyncIterable<Uint8Array>,
	): Promise<{ checksum: string; bytes: number }> {
		let temporary: string | undefined;
		try {
			const hash = createHash("sha256");
			let bytes = 0;
			const target = await this.target(key, true);
			temporary = join(dirname(target), `.publication-${randomUUID()}`);
			const handle = await open(temporary, "wx", 0o600);
			try {
				for await (const chunk of source) {
					bytes += chunk.byteLength;
					if (bytes > this.maxBytes)
						throw new PublicationFailure("STORAGE_FAILED");
					hash.update(chunk);
					await handle.writeFile(chunk);
				}
				await handle.sync();
			} finally {
				await handle.close();
			}
			// Hard linking publishes without replacing an existing object, including races.
			await link(temporary, target).catch((error: unknown) => {
				if (
					!(
						error instanceof Error &&
						"code" in error &&
						error.code === "EEXIST"
					)
				)
					throw error;
			});
			const checksum = `sha256:${hash.digest("hex")}`;
			await this.verify(key, checksum, bytes);
			return { checksum, bytes };
		} catch (error: unknown) {
			throw publicationFailure(error, "STORAGE_FAILED");
		} finally {
			if (temporary) await unlink(temporary).catch(() => {});
		}
	}

	async verify(key: string, checksum: string, bytes: number): Promise<void> {
		await this.inspect(key, checksum, bytes);
	}

	async read(
		key: string,
		checksum: string,
		bytes: number,
	): Promise<Uint8Array> {
		const chunks: Buffer[] = [];
		await this.inspect(key, checksum, bytes, (chunk) => {
			chunks.push(Buffer.from(chunk));
		});
		return Buffer.concat(chunks);
	}

	private async inspect(
		key: string,
		checksum: string,
		bytes: number,
		onChunk?: (chunk: Uint8Array) => void,
	): Promise<void> {
		try {
			const target = await this.target(key, false);
			const info = await lstat(target);
			if (
				!info.isFile() ||
				info.isSymbolicLink() ||
				info.size !== bytes ||
				bytes > this.maxBytes
			)
				throw new PublicationFailure("ARTIFACT_MISMATCH");
			const handle = await open(
				target,
				constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
			);
			try {
				const actual = await handle.stat();
				if (actual.ino !== info.ino || actual.dev !== info.dev)
					throw new PublicationFailure("ARTIFACT_MISMATCH");
				const hash = createHash("sha256");
				let read = 0;
				for await (const chunk of handle.createReadStream({
					autoClose: false,
				})) {
					read += chunk.byteLength;
					if (read > bytes) throw new PublicationFailure("ARTIFACT_MISMATCH");
					hash.update(chunk);
					onChunk?.(chunk);
				}
				if (read !== bytes || `sha256:${hash.digest("hex")}` !== checksum)
					throw new PublicationFailure("ARTIFACT_MISMATCH");
			} finally {
				await handle.close();
			}
		} catch (error: unknown) {
			throw publicationFailure(error, "STORAGE_FAILED");
		}
	}
}
