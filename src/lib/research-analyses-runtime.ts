import { auth } from "@/auth";
import { researchDb } from "./research-db";
import { FileResearchArtifactStorage } from "./research-publication-storage";
import { createResearchAnalysisHandlers } from "./research-analyses-http";
import { fail } from "./research-store";
export const researchAnalysisHandlers = createResearchAnalysisHandlers({
	session: async () => auth(),
	database: researchDb,
	enabled: () => process.env.RESEARCH_V2_EXPERIMENTAL === "true",
	artifacts: () =>
		new FileResearchArtifactStorage(
			process.env.RESEARCH_ARTIFACT_ROOT || fail("DEPENDENCY_UNAVAILABLE", 503),
		),
});
