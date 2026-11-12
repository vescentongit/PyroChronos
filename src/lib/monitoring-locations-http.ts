import {
	createMonitoringLocation,
	getMonitoringLocation,
	listMonitoringLocations,
	type LocationDatabase,
} from "./monitoring-locations";
import type { ResearchArtifactReader } from "./monitoring-location-evidence";
import {
	privateResearchJson,
	researchListQuery,
	researchRequestBody,
	withPrivateResearchRequest,
	type ResearchHttpDependencies,
} from "./research-http";
import { fail } from "./research-store";

interface HandlerDependencies extends ResearchHttpDependencies {
	database(): LocationDatabase;
	artifacts(): ResearchArtifactReader;
}
interface LocationRouteContext {
	params: Promise<{ workspaceId: string; locationId?: string }>;
}

export function createMonitoringLocationHandlers(
	dependencies: HandlerDependencies,
) {
	function handle(
		request: Request,
		context: LocationRouteContext,
		operation: "create" | "list" | "detail",
	): Promise<Response> {
		return withPrivateResearchRequest(request, dependencies, async (userId) => {
			const { workspaceId, locationId } = await context.params;
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
			if (operation === "create")
				return privateResearchJson(
					await createMonitoringLocation(
						service,
						workspaceId,
						userId,
						await researchRequestBody(request),
					),
					201,
				);
			if (operation === "detail")
				return privateResearchJson(
					await getMonitoringLocation(
						service,
						workspaceId,
						userId,
						locationId ?? fail("NOT_FOUND", 404),
					),
				);
			return privateResearchJson(
				await listMonitoringLocations(
					service,
					workspaceId,
					userId,
					researchListQuery(request),
				),
			);
		});
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
