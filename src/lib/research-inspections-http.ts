import type { LocationDatabase } from "./monitoring-locations.ts";
import {
	createInspectionAssignment,
	listInspectionAssignments,
	updateInspectionAssignment,
} from "./inspection-assignments.ts";
import {
	correctResearchReport,
	createResearchReport,
	listResearchReports,
} from "./research-reports.ts";
import {
	privateResearchJson,
	researchListQuery,
	researchRequestBody,
	withPrivateResearchRequest,
	type ResearchHttpDependencies,
} from "./research-http.ts";
import { fail } from "./research-store.ts";

interface InspectionHttpDependencies extends ResearchHttpDependencies {
	database(): LocationDatabase;
}
interface InspectionRouteContext {
	params: Promise<{
		workspaceId: string;
		locationId?: string;
		assignmentId?: string;
		reportId?: string;
	}>;
}
type Operation =
	| "assignment-create"
	| "assignment-list"
	| "assignment-update"
	| "report-create"
	| "report-list"
	| "report-correct";
export function createResearchInspectionHandlers(
	dependencies: InspectionHttpDependencies,
) {
	function handle(
		request: Request,
		context: InspectionRouteContext,
		operation: Operation,
	): Promise<Response> {
		return withPrivateResearchRequest(request, dependencies, async (userId) => {
			const params = await context.params;
			const db = dependencies.database();
			const workspaceId = params.workspaceId;
			const resource = (id: string | undefined) => id ?? fail("NOT_FOUND", 404);
			switch (operation) {
				case "assignment-create":
					return privateResearchJson(
						await createInspectionAssignment(
							db,
							workspaceId,
							userId,
							resource(params.locationId),
							await researchRequestBody(request),
						),
						201,
					);
				case "assignment-list":
					return privateResearchJson(
						await listInspectionAssignments(
							db,
							workspaceId,
							userId,
							resource(params.locationId),
							researchListQuery(request),
						),
					);
				case "assignment-update":
					return privateResearchJson(
						await updateInspectionAssignment(
							db,
							workspaceId,
							userId,
							resource(params.assignmentId),
							await researchRequestBody(request),
						),
					);
				case "report-create":
					return privateResearchJson(
						await createResearchReport(
							db,
							workspaceId,
							userId,
							resource(params.assignmentId),
							await researchRequestBody(request),
						),
						201,
					);
				case "report-list":
					return privateResearchJson(
						await listResearchReports(
							db,
							workspaceId,
							userId,
							resource(params.locationId),
							researchListQuery(request),
						),
					);
				case "report-correct":
					return privateResearchJson(
						await correctResearchReport(
							db,
							workspaceId,
							userId,
							resource(params.reportId),
							await researchRequestBody(request),
						),
					);
			}
		});
	}
	return {
		createAssignment: (request: Request, context: InspectionRouteContext) =>
			handle(request, context, "assignment-create"),
		listAssignments: (request: Request, context: InspectionRouteContext) =>
			handle(request, context, "assignment-list"),
		updateAssignment: (request: Request, context: InspectionRouteContext) =>
			handle(request, context, "assignment-update"),
		createReport: (request: Request, context: InspectionRouteContext) =>
			handle(request, context, "report-create"),
		listReports: (request: Request, context: InspectionRouteContext) =>
			handle(request, context, "report-list"),
		correctReport: (request: Request, context: InspectionRouteContext) =>
			handle(request, context, "report-correct"),
	};
}
