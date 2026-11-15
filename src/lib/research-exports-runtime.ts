import { auth } from "@/auth";
import { researchDb } from "./research-db";
import { createResearchExportHandlers } from "./research-exports-http";
import { privateResearchExportStorage } from "./research-export-storage";
import { fail } from "./research-store";

export const researchExportHandlers = createResearchExportHandlers({
	session: async () => auth(),
	database: researchDb,
	enabled: () => process.env.RESEARCH_V2_EXPERIMENTAL === "true",
	storage: () =>
		privateResearchExportStorage(
			process.env.RESEARCH_ARTIFACT_ROOT || fail("DEPENDENCY_UNAVAILABLE", 503),
		),
});
