BEGIN;
CREATE TYPE "P1ResearchExportStatus" AS ENUM ('queued','running','ready','failed');
CREATE TYPE "P1ResearchExportKind" AS ENUM ('raw_hotspots_csv','harmonized_aggregates_csv');

CREATE TABLE "ResearchExport" (
  id TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "analysisId" TEXT NOT NULL, "requestedById" TEXT NOT NULL,
  "exportKey" VARCHAR(71) NOT NULL, "periodRole" TEXT NOT NULL, kind "P1ResearchExportKind" NOT NULL,
  "analysisChecksum" VARCHAR(71) NOT NULL, "manifestChecksum" VARCHAR(71) NOT NULL, "formatterVersion" VARCHAR(71) NOT NULL,
  "sanitizationVersion" TEXT NOT NULL, "inspectionSnapshot" JSONB NOT NULL, "snapshotChecksum" VARCHAR(71) NOT NULL,
  status "P1ResearchExportStatus" NOT NULL DEFAULT 'queued', "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMPTZ(3), "completedAt" TIMESTAMPTZ(3), "resultAttemptId" TEXT, error JSONB,
  CONSTRAINT "ResearchExport_scope_key" UNIQUE(id,"workspaceId"),
  CONSTRAINT "ResearchExport_resultAttemptId_key" UNIQUE("resultAttemptId"),
  CONSTRAINT "ResearchExport_analysis_fkey" FOREIGN KEY("analysisId","workspaceId") REFERENCES "AnalysisResult"(id,"workspaceId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT "ResearchExport_requester_fkey" FOREIGN KEY("workspaceId","requestedById") REFERENCES "Membership"("workspaceId","userId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK ("periodRole" IN ('primary','comparison') AND "exportKey" ~ '^sha256:[a-f0-9]{64}$'
    AND "analysisChecksum" ~ '^sha256:[a-f0-9]{64}$' AND "manifestChecksum" ~ '^sha256:[a-f0-9]{64}$'
    AND "formatterVersion" ~ '^sha256:[a-f0-9]{64}$' AND "snapshotChecksum" ~ '^sha256:[a-f0-9]{64}$'
    AND jsonb_typeof("inspectionSnapshot")='object' AND isfinite("createdAt")),
  CHECK (((status='queued' AND "completedAt" IS NULL AND "resultAttemptId" IS NULL AND error IS NULL)
    OR (status='running' AND "startedAt" IS NOT NULL AND "completedAt" IS NULL AND "resultAttemptId" IS NULL AND error IS NULL)
    OR (status='ready' AND "startedAt" IS NOT NULL AND "completedAt" IS NOT NULL AND "resultAttemptId" IS NOT NULL AND error IS NULL)
    OR (status='failed' AND "completedAt" IS NOT NULL AND "resultAttemptId" IS NULL AND jsonb_typeof(error)='object')) IS TRUE),
  CHECK (("startedAt" IS NULL OR (isfinite("startedAt") AND "startedAt">="createdAt")) AND ("completedAt" IS NULL OR (isfinite("completedAt") AND "completedAt">=COALESCE("startedAt","createdAt"))))
);
CREATE INDEX "ResearchExport_dedup_idx" ON "ResearchExport"("workspaceId","exportKey");
CREATE INDEX "ResearchExport_queue_idx" ON "ResearchExport"(status,"createdAt");
CREATE UNIQUE INDEX "ResearchExport_reusable_key" ON "ResearchExport"("workspaceId","exportKey") WHERE status<>'failed';

CREATE TABLE "ResearchExportAttempt" (
  id TEXT PRIMARY KEY, "exportId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "attemptNo" INTEGER NOT NULL,
  "leaseToken" UUID NOT NULL UNIQUE, status "AnalysisAttemptStatus" NOT NULL DEFAULT 'running',
  "claimedAt" TIMESTAMPTZ(3) NOT NULL, "heartbeatAt" TIMESTAMPTZ(3) NOT NULL, "leaseExpiresAt" TIMESTAMPTZ(3) NOT NULL,
  "completedAt" TIMESTAMPTZ(3), "errorCode" TEXT, retryable BOOLEAN,
  CONSTRAINT "ResearchExportAttempt_scope_key" UNIQUE(id,"exportId","workspaceId"),
  CONSTRAINT "ResearchExportAttempt_sequence_key" UNIQUE("exportId","attemptNo"),
  CONSTRAINT "ResearchExportAttempt_export_fkey" FOREIGN KEY("exportId","workspaceId") REFERENCES "ResearchExport"(id,"workspaceId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK ("attemptNo">0 AND isfinite("claimedAt") AND isfinite("heartbeatAt") AND isfinite("leaseExpiresAt")
    AND "heartbeatAt">="claimedAt" AND "leaseExpiresAt">"heartbeatAt"),
  CHECK (((status='running' AND "completedAt" IS NULL AND "errorCode" IS NULL AND retryable IS NULL)
    OR (status='succeeded' AND "completedAt">="heartbeatAt" AND "completedAt"<"leaseExpiresAt" AND "errorCode" IS NULL AND retryable IS NULL)
    OR (status IN ('failed','expired') AND "completedAt">="heartbeatAt" AND "errorCode" IN ('LEASE_EXPIRED','DEPENDENCY_UNAVAILABLE','CAPACITY_LIMIT','INVALID_REQUEST','INTERNAL_ERROR') AND retryable IS NOT NULL)) IS TRUE),
  CHECK ("completedAt" IS NULL OR (isfinite("completedAt") AND (status<>'expired' OR "completedAt">="leaseExpiresAt")))
);
CREATE INDEX "ResearchExportAttempt_lease_idx" ON "ResearchExportAttempt"(status,"leaseExpiresAt");
ALTER TABLE "ResearchExport" ADD CONSTRAINT "ResearchExport_result_attempt_fkey" FOREIGN KEY("resultAttemptId",id,"workspaceId") REFERENCES "ResearchExportAttempt"(id,"exportId","workspaceId") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "ResearchExportArtifact" (
  id TEXT PRIMARY KEY, "exportId" TEXT NOT NULL, "workspaceId" TEXT NOT NULL, "attemptId" TEXT NOT NULL,
  kind TEXT NOT NULL, "objectKey" TEXT NOT NULL UNIQUE, checksum VARCHAR(71) NOT NULL, bytes BIGINT NOT NULL, "rowCount" INTEGER,
  CONSTRAINT "ResearchExportArtifact_kind_key" UNIQUE("attemptId",kind),
  CONSTRAINT "ResearchExportArtifact_attempt_fkey" FOREIGN KEY("attemptId","exportId","workspaceId") REFERENCES "ResearchExportAttempt"(id,"exportId","workspaceId") ON DELETE RESTRICT ON UPDATE RESTRICT,
  CHECK ((kind IN ('csv','manifest') AND checksum ~ '^sha256:[a-f0-9]{64}$' AND bytes BETWEEN 0 AND 67108864
    AND "objectKey" ~ '^[A-Za-z0-9_-]+(/[A-Za-z0-9_.-]+)*$' AND "objectKey" !~ '(^|/)\.{1,2}(/|$)'
    AND ((kind='csv' AND "rowCount">=0) OR (kind='manifest' AND "rowCount" IS NULL))) IS TRUE)
);

CREATE FUNCTION r2_export_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a "ResearchExportAttempt"; r "AnalysisResult"; j "P1AnalysisJob";
BEGIN
  IF TG_OP='INSERT' THEN
    SELECT * INTO r FROM "AnalysisResult" WHERE id=NEW."analysisId" AND "workspaceId"=NEW."workspaceId";
    SELECT * INTO j FROM "P1AnalysisJob" WHERE id=r."jobId";
    IF NEW.status<>'queued' OR NEW."startedAt" IS NOT NULL OR r.id IS NULL OR j.status<>'succeeded' OR j."resultId" IS DISTINCT FROM r.id
      OR (NEW."periodRole"='comparison' AND r.payload->'comparison'='null'::jsonb) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid initial export';
    END IF;
  ELSE
    IF OLD.status IN ('ready','failed') OR
      ROW(NEW.id,NEW."workspaceId",NEW."analysisId",NEW."requestedById",NEW."exportKey",NEW."periodRole",NEW.kind,NEW."analysisChecksum",NEW."manifestChecksum",NEW."formatterVersion",NEW."sanitizationVersion",NEW."inspectionSnapshot",NEW."snapshotChecksum",NEW."createdAt")
      IS DISTINCT FROM ROW(OLD.id,OLD."workspaceId",OLD."analysisId",OLD."requestedById",OLD."exportKey",OLD."periodRole",OLD.kind,OLD."analysisChecksum",OLD."manifestChecksum",OLD."formatterVersion",OLD."sanitizationVersion",OLD."inspectionSnapshot",OLD."snapshotChecksum",OLD."createdAt")
      OR (OLD."startedAt" IS NOT NULL AND NEW."startedAt" IS DISTINCT FROM OLD."startedAt")
      OR NOT ((OLD.status='queued' AND NEW.status IN ('running','failed')) OR (OLD.status='running' AND NEW.status IN ('running','queued','ready','failed'))) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Export input and terminal history are immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ResearchExport_guard" BEFORE INSERT OR UPDATE ON "ResearchExport" FOR EACH ROW EXECUTE FUNCTION r2_export_guard();

CREATE FUNCTION r2_export_attempt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j "ResearchExport"; previous INTEGER;
BEGIN
  SELECT * INTO j FROM "ResearchExport" WHERE id=NEW."exportId" FOR UPDATE;
  SELECT COALESCE(max("attemptNo"),0) INTO previous FROM "ResearchExportAttempt" WHERE "exportId"=NEW."exportId";
  IF TG_OP='INSERT' THEN
    IF j.status<>'running' OR NEW.status<>'running' OR NEW."attemptNo"<>previous+1 OR NEW."leaseExpiresAt"<=clock_timestamp()
      OR EXISTS(SELECT 1 FROM "ResearchExportAttempt" WHERE "exportId"=NEW."exportId" AND status='running') THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid export claim';
    END IF;
  ELSE
    IF OLD.status<>'running' OR j.status<>'running' OR NEW."attemptNo"<>previous OR
      ROW(NEW.id,NEW."exportId",NEW."workspaceId",NEW."attemptNo",NEW."leaseToken",NEW."claimedAt")
      IS DISTINCT FROM ROW(OLD.id,OLD."exportId",OLD."workspaceId",OLD."attemptNo",OLD."leaseToken",OLD."claimedAt")
      OR NEW."heartbeatAt"<OLD."heartbeatAt" OR NEW."leaseExpiresAt"<OLD."leaseExpiresAt"
      OR (NEW.status<>'expired' AND OLD."leaseExpiresAt"<=clock_timestamp())
      OR (NEW.status='expired' AND OLD."leaseExpiresAt">clock_timestamp())
      OR (NEW.status='succeeded' AND (SELECT count(*) FROM "ResearchExportArtifact" WHERE "attemptId"=NEW.id)<>2) THEN
      RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Invalid export attempt transition';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ResearchExportAttempt_guard" BEFORE INSERT OR UPDATE ON "ResearchExportAttempt" FOR EACH ROW EXECUTE FUNCTION r2_export_attempt_guard();

CREATE FUNCTION r2_export_artifact_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a "ResearchExportAttempt"; j "ResearchExport";
BEGIN
  SELECT * INTO j FROM "ResearchExport" WHERE id=NEW."exportId" FOR UPDATE;
  SELECT * INTO a FROM "ResearchExportAttempt" WHERE id=NEW."attemptId";
  IF j.status<>'running' OR a.status<>'running' OR a."leaseExpiresAt"<=clock_timestamp()
    OR a."attemptNo"<>(SELECT max("attemptNo") FROM "ResearchExportAttempt" WHERE "exportId"=j.id) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Export publication is not open';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ResearchExportArtifact_guard" BEFORE INSERT ON "ResearchExportArtifact" FOR EACH ROW EXECUTE FUNCTION r2_export_artifact_guard();

CREATE FUNCTION r2_export_state_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a "ResearchExportAttempt";
BEGIN
  SELECT * INTO a FROM "ResearchExportAttempt" WHERE "exportId"=NEW.id ORDER BY "attemptNo" DESC LIMIT 1;
  IF (NEW.status='running' AND (a.id IS NULL OR a.status<>'running'))
    OR (NEW.status='queued' AND a.id IS NOT NULL AND a.status NOT IN ('failed','expired'))
    OR (NEW.status='ready' AND (a.id IS NULL OR a.status<>'succeeded' OR NEW."resultAttemptId" IS DISTINCT FROM a.id
      OR NEW."completedAt"<a."completedAt" OR NEW."completedAt">=a."leaseExpiresAt" OR (SELECT count(*) FROM "ResearchExportArtifact" WHERE "attemptId"=a.id)<>2))
    OR (NEW.status='failed' AND a.id IS NOT NULL AND a.status NOT IN ('failed','expired')) THEN
    RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='Export lifecycle does not match its latest attempt';
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER "ResearchExport_state_guard" AFTER INSERT OR UPDATE ON "ResearchExport" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION r2_export_state_guard();
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ResearchExport','ResearchExportAttempt','ResearchExportArtifact'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION r2_preserve_history()',t||'_no_delete',t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION r2_preserve_history()',t||'_no_truncate',t);
  END LOOP;
END;
$$;
CREATE TRIGGER "ResearchExportArtifact_no_update" BEFORE UPDATE ON "ResearchExportArtifact" FOR EACH ROW EXECUTE FUNCTION r2_preserve_history();
COMMIT;
