import { researchInspectionHandlers } from "@/lib/research-inspections-runtime";

export const runtime = "nodejs";
export const GET = researchInspectionHandlers.listAssignments;
export const POST = researchInspectionHandlers.createAssignment;
