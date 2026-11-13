import { auth } from "@/auth";
import { researchDb } from "./research-db";
import { createResearchInspectionHandlers } from "./research-inspections-http";

export const researchInspectionHandlers = createResearchInspectionHandlers({
	session: async () => auth(),
	database: researchDb,
	enabled: () => process.env.RESEARCH_V2_EXPERIMENTAL === "true",
});
