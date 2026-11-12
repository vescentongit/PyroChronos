import { errorPayload, fail, ResearchFailure } from "./research-store.ts";

export interface ResearchHttpDependencies {
	session(): Promise<{ user?: { id?: string } } | null>;
	enabled(): boolean;
}
const errorStatuses = new Map([
	["INVALID_REQUEST", 400],
	["UNAUTHENTICATED", 401],
	["FORBIDDEN", 403],
	["NOT_FOUND", 404],
	["IDEMPOTENCY_CONFLICT", 409],
	["REVISION_CONFLICT", 409],
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
				...(status === 429 ? { "Retry-After": "60" } : {}),
			},
		});
	}
}
export async function researchRequestBody(request: Request): Promise<unknown> {
	return request.json().catch(() => fail("INVALID_REQUEST"));
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
