import { errorPayload, fail, ResearchFailure } from "./research-store.ts";
import { backpressureHeaders, capacityPolicy } from "./research-capacity.ts";

export interface ResearchHttpDependencies {
	session(): Promise<{ user?: { id?: string } } | null>;
	enabled(): boolean;
}
const errorStatuses = new Map([
	["INVALID_REQUEST", 400],
	["PAYLOAD_TOO_LARGE", 413],
	["UNAUTHENTICATED", 401],
	["FORBIDDEN", 403],
	["NOT_FOUND", 404],
	["IDEMPOTENCY_CONFLICT", 409],
	["REVISION_CONFLICT", 409],
	["RESULT_NOT_READY", 409],
	["RATE_LIMITED", 429],
	["DEPENDENCY_UNAVAILABLE", 503],
	["CAPACITY_LIMIT", 503],
]);
const privateHeaders = { "Cache-Control": "private, no-store" };
export function privateResearchJson(value: unknown, status = 200): Response {
	return Response.json(value, { status, headers: privateHeaders });
}
export async function withPrivateResearchRequest(
	request: Request,
	dependencies: ResearchHttpDependencies,
	action: (userId: string) => Promise<Response>,
): Promise<Response> {
	try {
		if (!dependencies.enabled()) fail("DEPENDENCY_UNAVAILABLE", 503);
		const session = await dependencies.session();
		const userId = session?.user?.id || fail("UNAUTHENTICATED", 401);
		if (!["GET", "HEAD"].includes(request.method)) {
			const origin = request.headers.get("origin");
			if (origin && origin !== new URL(request.url).origin)
				fail("FORBIDDEN", 403);
		}
		return await action(userId);
	} catch (error: unknown) {
		const code =
			error instanceof ResearchFailure && errorStatuses.has(error.code)
				? error.code
				: "INTERNAL_ERROR";
		const status = errorStatuses.get(code) ?? 500;
		return Response.json(errorPayload(code), {
			status,
			headers: {
				...privateHeaders,
				...backpressureHeaders(code),
			},
		});
	}
}
export async function researchRequestBody(request: Request): Promise<unknown> {
	if (
		Number(request.headers.get("content-length") || 0) >
		capacityPolicy.requestBytes
	)
		return fail("PAYLOAD_TOO_LARGE", 413);
	if (!request.body) return fail("INVALID_REQUEST");
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		for (;;) {
			const part = await reader.read();
			if (part.done) break;
			size += part.value.byteLength;
			if (size > capacityPolicy.requestBytes) {
				await reader.cancel();
				return fail("PAYLOAD_TOO_LARGE", 413);
			}
			chunks.push(part.value);
		}
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch (error) {
		if (error instanceof ResearchFailure) throw error;
		return fail("INVALID_REQUEST");
	} finally {
		reader.releaseLock();
	}
}
export function researchListQuery(request: Request): Record<string, string> {
	const query = new URL(request.url).searchParams;
	if (
		[...query.keys()].some(
			(key) =>
				!["limit", "cursor"].includes(key) || query.getAll(key).length !== 1,
		)
	)
		fail("INVALID_REQUEST");
	return Object.fromEntries(query);
}
