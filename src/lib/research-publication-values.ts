import { createHash } from "node:crypto";

const publicationErrorCodes = [
	"INVALID_OUTPUT",
	"UNSAFE_METADATA",
	"ARTIFACT_MISMATCH",
	"STORAGE_FAILED",
	"DATABASE_FAILED",
	"LEASE_LOST",
	"PUBLICATION_CONFLICT",
] as const;
export type PublicationErrorCode = (typeof publicationErrorCodes)[number];

export class PublicationFailure extends Error {
	readonly code: PublicationErrorCode;
	constructor(code: PublicationErrorCode) {
		const safeCode =
			publicationErrorCodes.find((allowed) => allowed === code) ??
			"INVALID_OUTPUT";
		super(safeCode);
		this.name = "PublicationFailure";
		this.code = safeCode;
	}
}

export function publicationFailure(
	error: unknown,
	fallback: PublicationErrorCode,
): PublicationFailure {
	return new PublicationFailure(
		error instanceof PublicationFailure ? error.code : fallback,
	);
}

export function canonicalJson(value: unknown): string {
	const seen = new WeakSet<object>();
	function encode(item: unknown): string {
		if (item === null || typeof item === "boolean" || typeof item === "string")
			return JSON.stringify(item);
		if (typeof item === "number" && Number.isFinite(item))
			return JSON.stringify(item);
		if (typeof item !== "object" || item === null || seen.has(item))
			throw new PublicationFailure("INVALID_OUTPUT");
		seen.add(item);
		let result: string;
		if (Array.isArray(item)) result = `[${item.map(encode).join(",")}]`;
		else {
			if (
				Object.getPrototypeOf(item) !== Object.prototype &&
				Object.getPrototypeOf(item) !== null
			)
				throw new PublicationFailure("INVALID_OUTPUT");
			const record = item as Record<string, unknown>;
			result = `{${Object.keys(record)
				.sort()
				.map((key) => `${JSON.stringify(key)}:${encode(record[key])}`)
				.join(",")}}`;
		}
		seen.delete(item);
		return result;
	}
	return encode(value);
}

export function publicationChecksum(bytes: Uint8Array | string): string {
	return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function publicationSecrets(
	extra: readonly string[] = [],
): readonly string[] {
	const configured = [
		process.env.DATABASE_URL,
		process.env.FIRMS_MAP_KEY,
		process.env.COORDINATOR_TOKEN,
		process.env.AUTH_SECRET,
		process.env.AWS_SECRET_ACCESS_KEY,
		...extra,
	];
	return [
		...new Set(
			configured
				.filter((v): v is string => typeof v === "string" && v.length > 0)
				.flatMap((v) => [v, encodeURIComponent(v)]),
		),
	];
}

export function assertPublicationSafe(
	value: string | Uint8Array,
	secrets: readonly string[],
): void {
	const bytes =
		typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
	if (secrets.some((secret) => bytes.includes(Buffer.from(secret))))
		throw new PublicationFailure("UNSAFE_METADATA");
	const text = bytes.toString("utf8");
	if (
		/(?:postgres(?:ql)?:\/\/|https?:\/\/[^\s/]+:[^\s/]+@|[?&](?:x-amz-signature|access_token|api_key)=|\/api\/area\/csv\/)/i.test(
			text,
		)
	)
		throw new PublicationFailure("UNSAFE_METADATA");
}

export function assertPublicationMetadataSafe(
	value: unknown,
	secrets: readonly string[],
): void {
	assertPublicationSafe(canonicalJson(value), secrets);
	function visit(item: unknown): void {
		if (typeof item === "string") assertPublicationSafe(item, secrets);
		else if (Array.isArray(item)) item.forEach(visit);
		else if (item !== null && typeof item === "object") {
			for (const [key, nested] of Object.entries(item)) {
				assertPublicationSafe(key, secrets);
				visit(nested);
			}
		}
	}
	visit(value);
}
