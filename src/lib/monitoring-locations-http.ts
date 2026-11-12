import {
	createMonitoringLocation,
	getMonitoringLocation,
	listMonitoringLocations,
	type LocationDatabase,
} from "./monitoring-locations";
import type { ResearchArtifactReader } from "./monitoring-location-evidence";
import { errorPayload, fail, ResearchFailure } from "./research-store";

interface HandlerDependencies {
	session(): Promise<{ user?: { id?: string } } | null>;
	database(): LocationDatabase;
	artifacts(): ResearchArtifactReader;
	enabled(): boolean;
}
interface LocationRouteContext {
	params: Promise<{ workspaceId: string; locationId?: string }>;
}
const errorStatuses = new Map([
	["INVALID_REQUEST", 400],
	["UNAUTHENTICATED", 401],
	["FORBIDDEN", 403],
	["NOT_FOUND", 404],
	["IDEMPOTENCY_CONFLICT", 409],
	["RATE_LIMITED", 429],
	["DEPENDENCY_UNAVAILABLE", 503],
	["CAPACITY_LIMIT", 503],
]);
const headers = { "Cache-Control": "private, no-store" };

export function createMonitoringLocationHandlers(
	dependencies: HandlerDependencies,
) {
	async function handle(
		request: Request,
		context: LocationRouteContext,
		operation: "create" | "list" | "detail",
	): Promise<Response> {
		try {
			if (!dependencies.enabled()) fail("DEPENDENCY_UNAVAILABLE", 503);
			const session = await dependencies.session();
			const userId = session?.user?.id ?? fail("UNAUTHENTICATED", 401);
			const { workspaceId, locationId } = await context.params;
			const url = new URL(request.url);
			if (operation === "create") {
				const origin = request.headers.get("origin");
				if (origin && origin !== url.origin) fail("FORBIDDEN", 403);
			}
			const service = {
				database: dependencies.database(),
				artifacts: {
					async read(key: string, checksum: string, bytes: number) {
						try {
							return await dependencies.artifacts().read(key, checksum, bytes);
						} catch {
							return fail("DEPENDENCY_UNAVAILABLE", 503);
						}
					},
				},
			};
			if (operation === "create") {
				const body: unknown = await request
					.json()
					.catch(() => fail("INVALID_REQUEST"));
				const location = await createMonitoringLocation(
					service,
					workspaceId,
					userId,
					body,
				);
				return Response.json(location, { status: 201, headers });
			}
			if (operation === "detail") {
				const detailId = locationId ?? fail("NOT_FOUND", 404);
				return Response.json(
					await getMonitoringLocation(service, workspaceId, userId, detailId),
					{ headers },
				);
			}
			if (
				[...url.searchParams.keys()].some(
					(key) =>
						!["limit", "cursor"].includes(key) ||
						url.searchParams.getAll(key).length !== 1,
				)
			)
				fail("INVALID_REQUEST");
			const query = Object.fromEntries(url.searchParams);
			return Response.json(
				await listMonitoringLocations(service, workspaceId, userId, query),
				{ headers },
			);
		} catch (error: unknown) {
			const code =
				error instanceof ResearchFailure && errorStatuses.has(error.code)
					? error.code
					: "INTERNAL_ERROR";
			const status = errorStatuses.get(code) ?? 500;
			return Response.json(errorPayload(code), {
				status,
				headers: {
					...headers,
					...(status === 429 ? { "Retry-After": "60" } : {}),
				},
			});
		}
	}
	return {
		POST: (request: Request, context: LocationRouteContext) =>
			handle(request, context, "create"),
		GET: (request: Request, context: LocationRouteContext) =>
			handle(request, context, "list"),
		detailGET: (request: Request, context: LocationRouteContext) =>
			handle(request, context, "detail"),
	};
}
