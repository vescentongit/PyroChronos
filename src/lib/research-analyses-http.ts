import type { LocationDatabase } from "./monitoring-locations.ts";
import type { ResearchArtifactReader } from "./research-observations.ts";
import { submitP1Analysis } from "./research-analysis-submissions.ts";
import {
	readResearchAnalysis,
	readResearchJob,
	readResearchDays,
	readResearchDetections,
	readResearchTile,
} from "./research-analyses.ts";
import {
	privateResearchJson,
	researchRequestBody,
	withPrivateResearchRequest,
	type ResearchHttpDependencies,
} from "./research-http.ts";
import { fail } from "./research-store.ts";

interface Dependencies extends ResearchHttpDependencies {
	database(): LocationDatabase;
	artifacts(): ResearchArtifactReader;
}
interface Context {
	params: Promise<{
		workspaceId: string;
		analysisId?: string;
		jobId?: string;
		layer?: string;
		z?: string;
		x?: string;
		y?: string;
	}>;
}
export function createResearchAnalysisHandlers(deps: Dependencies) {
	const handle = (
		request: Request,
		context: Context,
		operation: "create" | "job" | "result" | "days" | "detections" | "tile",
	) =>
		withPrivateResearchRequest(request, deps, async (userId) => {
			const params = await context.params,
				db = deps.database(),
				query = new URL(request.url).searchParams;
			const allowed =
				operation === "days"
					? ["periodRole", "month"]
					: operation === "detections"
						? ["periodRole", "cursor", "limit"]
						: operation === "tile"
							? ["periodRole"]
							: operation === "job" ? ["requestId"] : [];
			if (
				[...query.keys()].some(
					(key) => !allowed.includes(key) || query.getAll(key).length !== 1,
				)
			)
				return fail("INVALID_REQUEST");
			if (operation === "create") {
				const result = await submitP1Analysis(
					db,
					params.workspaceId,
					userId,
					await researchRequestBody(request),
				);
				return privateResearchJson(result.value, result.status);
			}
			if (operation === "job")
				return privateResearchJson(
					await readResearchJob(
						db,
						params.workspaceId,
						userId,
						params.jobId ?? fail("NOT_FOUND", 404),
						query.get("requestId"),
					),
				);
			const id = params.analysisId ?? fail("NOT_FOUND", 404);
			if (operation === "result")
				return privateResearchJson(
					await readResearchAnalysis(db, params.workspaceId, userId, id),
				);
			const reader: ResearchArtifactReader = {
				read: (...args) => deps.artifacts().read(...args),
			};
			const role = query.get("periodRole") ?? "";
			if (operation === "days")
				return privateResearchJson(
					await readResearchDays(
						db,
						reader,
						params.workspaceId,
						userId,
						id,
						role,
						query.get("month") ?? "",
					),
				);
			if (operation === "detections")
				return privateResearchJson(
					await readResearchDetections(
						db,
						reader,
						params.workspaceId,
						userId,
						id,
						role,
						query.get("cursor"),
						query.has("limit") ? Number(query.get("limit")) : 1000,
					),
				);
			if (params.layer !== "raw-density") return fail("NOT_FOUND", 404);
			return privateResearchJson(
				await readResearchTile(
					db,
					reader,
					params.workspaceId,
					userId,
					id,
					role,
					Number(params.z),
					Number(params.x),
					Number(params.y),
				),
			);
		});
	return {
		POST: (request: Request, context: Context) =>
			handle(request, context, "create"),
		jobGET: (request: Request, context: Context) =>
			handle(request, context, "job"),
		resultGET: (request: Request, context: Context) =>
			handle(request, context, "result"),
		daysGET: (request: Request, context: Context) =>
			handle(request, context, "days"),
		detectionsGET: (request: Request, context: Context) =>
			handle(request, context, "detections"),
		tileGET: (request: Request, context: Context) =>
			handle(request, context, "tile"),
	};
}
