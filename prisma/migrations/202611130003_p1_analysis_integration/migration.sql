BEGIN;
CREATE TABLE "P1AnalysisLocationRequest" (
  "jobId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  CONSTRAINT "P1AnalysisLocationRequest_pkey" PRIMARY KEY ("jobId","locationId"),
  CONSTRAINT "P1AnalysisLocationRequest_jobId_workspaceId_fkey" FOREIGN KEY ("jobId","workspaceId") REFERENCES "P1AnalysisJob"(id,"workspaceId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "P1AnalysisLocationRequest_locationId_workspaceId_fkey" FOREIGN KEY ("locationId","workspaceId") REFERENCES "MonitoringLocation"(id,"workspaceId") ON DELETE RESTRICT ON UPDATE RESTRICT
);
CREATE INDEX "P1AnalysisLocationRequest_workspaceId_locationId_idx" ON "P1AnalysisLocationRequest"("workspaceId","locationId");
CREATE TRIGGER "P1AnalysisLocationRequest_no_update" BEFORE UPDATE ON "P1AnalysisLocationRequest" FOR EACH ROW EXECUTE FUNCTION r2_preserve_history();
CREATE TRIGGER "P1AnalysisLocationRequest_no_delete" BEFORE DELETE ON "P1AnalysisLocationRequest" FOR EACH ROW EXECUTE FUNCTION r2_preserve_history();
CREATE TRIGGER "P1AnalysisLocationRequest_no_truncate" BEFORE TRUNCATE ON "P1AnalysisLocationRequest" FOR EACH STATEMENT EXECUTE FUNCTION r2_preserve_history();
COMMIT;
