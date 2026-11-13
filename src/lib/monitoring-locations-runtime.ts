import { auth } from "@/auth";
import { researchDb } from "./research-db";
import { createMonitoringLocationHandlers } from "./monitoring-locations-http";
import { FileResearchArtifactStorage } from "./research-publication-storage";
import { fail } from "./research-store";

export const monitoringLocationHandlers = createMonitoringLocationHandlers({
	session: async () => auth(),
	database: researchDb,
	enabled: () => process.env.RESEARCH_V2_EXPERIMENTAL === "true",
	artifacts: () => {
		const root = process.env.RESEARCH_ARTIFACT_ROOT;
		if (!root) return fail("DEPENDENCY_UNAVAILABLE", 503);
		return new FileResearchArtifactStorage(root);
	},
});
