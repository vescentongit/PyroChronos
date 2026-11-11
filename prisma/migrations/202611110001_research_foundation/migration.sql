-- R2-P1 Step 1: additive foundation only. No legacy table/data is altered.
-- Runtime roles must not own tables or have DDL/trigger-disabling privileges.
BEGIN;

-- CreateEnum
CREATE TYPE "AnalysisJobStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed');

-- CreateEnum
CREATE TYPE "AnalysisAttemptStatus" AS ENUM ('running', 'succeeded', 'failed', 'expired');

-- CreateEnum
CREATE TYPE "AnalysisArtifactKind" AS ENUM ('observations', 'daily', 'estimated_grid');

-- CreateTable
CREATE TABLE "AnalysisJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestId" UUID NOT NULL,
    "analysisKey" VARCHAR(71) NOT NULL,
    "areaId" TEXT NOT NULL,
    "areaRevision" INTEGER NOT NULL,
    "input" JSONB NOT NULL,
    "status" "AnalysisJobStatus" NOT NULL DEFAULT 'queued',
    "stage" TEXT,
    "progressPercent" DOUBLE PRECISION,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "resultId" TEXT,
    "error" JSONB,

    CONSTRAINT "AnalysisJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisJobAttempt" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "leaseToken" UUID NOT NULL,
    "status" "AnalysisAttemptStatus" NOT NULL DEFAULT 'running',
    "claimedAt" TIMESTAMPTZ(3) NOT NULL,
    "heartbeatAt" TIMESTAMPTZ(3) NOT NULL,
    "leaseExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "completedAt" TIMESTAMPTZ(3),
    "errorCode" TEXT,
    "retryable" BOOLEAN,

    CONSTRAINT "AnalysisJobAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisManifest" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "dataVersion" TEXT NOT NULL,
    "checksum" VARCHAR(71) NOT NULL,
    "content" JSONB NOT NULL,

    CONSTRAINT "AnalysisManifest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisResult" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "manifestId" TEXT NOT NULL,
    "dataVersion" TEXT NOT NULL,
    "generatedAt" TIMESTAMPTZ(3) NOT NULL,
    "publishedAt" TIMESTAMPTZ(3) NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "AnalysisResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisArtifact" (
    "id" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "AnalysisArtifactKind" NOT NULL,
    "periodRole" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "checksum" VARCHAR(71) NOT NULL,
    "bytes" BIGINT NOT NULL,
    "format" TEXT NOT NULL,

    CONSTRAINT "AnalysisArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringLocation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "requestId" UUID NOT NULL,
    "requestHash" VARCHAR(71) NOT NULL,
    "name" TEXT NOT NULL,
    "anchorDetectionId" TEXT NOT NULL,
    "anchor" JSONB NOT NULL,
    "initialAnalysisId" TEXT NOT NULL,
    "areaId" TEXT NOT NULL,
    "areaRevision" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdBy" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitoringLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitoringLocationAnalysis" (
    "locationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitoringLocationAnalysis_pkey" PRIMARY KEY ("locationId","analysisId")
);

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisJob_resultId_key" ON "AnalysisJob"("resultId");

-- CreateIndex
CREATE INDEX "AnalysisJob_workspaceId_analysisKey_idx" ON "AnalysisJob"("workspaceId", "analysisKey");

-- CreateIndex
CREATE INDEX "AnalysisJob_status_createdAt_idx" ON "AnalysisJob"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisJob_id_workspaceId_key" ON "AnalysisJob"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisJob_workspaceId_requestedById_requestId_key" ON "AnalysisJob"("workspaceId", "requestedById", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisJobAttempt_leaseToken_key" ON "AnalysisJobAttempt"("leaseToken");

-- CreateIndex
CREATE INDEX "AnalysisJobAttempt_status_leaseExpiresAt_idx" ON "AnalysisJobAttempt"("status", "leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisJobAttempt_jobId_attemptNo_key" ON "AnalysisJobAttempt"("jobId", "attemptNo");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisManifest_id_jobId_workspaceId_key" ON "AnalysisManifest"("id", "jobId", "workspaceId");

-- CreateIndex
CREATE INDEX "AnalysisResult_workspaceId_publishedAt_idx" ON "AnalysisResult"("workspaceId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisResult_id_workspaceId_key" ON "AnalysisResult"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisResult_jobId_workspaceId_key" ON "AnalysisResult"("jobId", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisArtifact_objectKey_key" ON "AnalysisArtifact"("objectKey");

-- CreateIndex
CREATE INDEX "AnalysisArtifact_resultId_kind_periodRole_idx" ON "AnalysisArtifact"("resultId", "kind", "periodRole");

-- CreateIndex
CREATE INDEX "MonitoringLocation_workspaceId_createdAt_id_idx" ON "MonitoringLocation"("workspaceId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringLocation_id_workspaceId_key" ON "MonitoringLocation"("id", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "MonitoringLocation_workspaceId_createdById_requestId_key" ON "MonitoringLocation"("workspaceId", "createdById", "requestId");

-- CreateIndex
CREATE INDEX "MonitoringLocationAnalysis_workspaceId_analysisId_idx" ON "MonitoringLocationAnalysis"("workspaceId", "analysisId");

-- AddForeignKey
ALTER TABLE "AnalysisJob" ADD CONSTRAINT "AnalysisJob_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "AnalysisResult"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AnalysisJobAttempt" ADD CONSTRAINT "AnalysisJobAttempt_jobId_workspaceId_fkey" FOREIGN KEY ("jobId", "workspaceId") REFERENCES "AnalysisJob"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AnalysisManifest" ADD CONSTRAINT "AnalysisManifest_jobId_workspaceId_fkey" FOREIGN KEY ("jobId", "workspaceId") REFERENCES "AnalysisJob"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AnalysisResult" ADD CONSTRAINT "AnalysisResult_jobId_workspaceId_fkey" FOREIGN KEY ("jobId", "workspaceId") REFERENCES "AnalysisJob"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AnalysisResult" ADD CONSTRAINT "AnalysisResult_manifestId_jobId_workspaceId_fkey" FOREIGN KEY ("manifestId", "jobId", "workspaceId") REFERENCES "AnalysisManifest"("id", "jobId", "workspaceId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "AnalysisArtifact" ADD CONSTRAINT "AnalysisArtifact_resultId_workspaceId_fkey" FOREIGN KEY ("resultId", "workspaceId") REFERENCES "AnalysisResult"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "MonitoringLocation" ADD CONSTRAINT "MonitoringLocation_initialAnalysisId_workspaceId_fkey" FOREIGN KEY ("initialAnalysisId", "workspaceId") REFERENCES "AnalysisResult"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "MonitoringLocationAnalysis" ADD CONSTRAINT "MonitoringLocationAnalysis_locationId_workspaceId_fkey" FOREIGN KEY ("locationId", "workspaceId") REFERENCES "MonitoringLocation"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "MonitoringLocationAnalysis" ADD CONSTRAINT "MonitoringLocationAnalysis_analysisId_workspaceId_fkey" FOREIGN KEY ("analysisId", "workspaceId") REFERENCES "AnalysisResult"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Prisma cannot express these lifecycle, envelope and history invariants.
ALTER TABLE "AnalysisJob" ADD CONSTRAINT "AnalysisJob_input_check" CHECK ((
    length(btrim("id")) > 0 AND length(btrim("workspaceId")) > 0
    AND length(btrim("requestedById")) > 0 AND length(btrim("areaId")) > 0
    AND "areaRevision" > 0 AND "analysisKey" ~ '^sha256:[a-f0-9]{64}$'
    AND jsonb_typeof("input") = 'object'
    AND "input"->'area'->>'workspaceId' = "workspaceId"
    AND "input"->'area'->>'id' = "areaId"
    AND "input"->'area'->'revision' = to_jsonb("areaRevision")
    AND "input"->'request'->>'requestId' = "requestId"::text
    AND "input"->'request'->>'areaId' = "areaId"
    AND "input"->'request'->'areaRevision' = to_jsonb("areaRevision")
) IS TRUE);
ALTER TABLE "AnalysisJob" ADD CONSTRAINT "AnalysisJob_state_check" CHECK ((
    CASE "status"
      WHEN 'queued' THEN "startedAt" IS NULL AND "completedAt" IS NULL AND "resultId" IS NULL AND "error" IS NULL
      WHEN 'running' THEN "startedAt" IS NOT NULL AND "completedAt" IS NULL AND "resultId" IS NULL AND "error" IS NULL
      WHEN 'succeeded' THEN "startedAt" IS NOT NULL AND "completedAt" IS NOT NULL AND "resultId" IS NOT NULL AND "error" IS NULL
      WHEN 'failed' THEN "completedAt" IS NOT NULL AND "resultId" IS NULL AND jsonb_typeof("error") = 'object'
        AND "error"->>'schemaVersion' = 'research-2' AND "error"->>'code' ~ '^[A-Z][A-Z0-9_]{0,63}$'
        AND jsonb_typeof("error"->'retryable') = 'boolean'
    END
) IS TRUE);
ALTER TABLE "AnalysisJob" ADD CONSTRAINT "AnalysisJob_time_check" CHECK (
    isfinite("createdAt") AND ("startedAt" IS NULL OR (isfinite("startedAt") AND "startedAt" >= "createdAt"))
    AND ("completedAt" IS NULL OR (isfinite("completedAt") AND "completedAt" >= coalesce("startedAt", "createdAt")))
    AND ("stage" IS NULL OR "stage" IN ('ingest', 'aggregate', 'harmonize', 'evaluate', 'publish'))
    AND ("progressPercent" IS NULL OR "progressPercent" BETWEEN 0 AND 100)
);

ALTER TABLE "AnalysisJobAttempt" ADD CONSTRAINT "AnalysisJobAttempt_lease_check" CHECK (
    "attemptNo" > 0 AND isfinite("claimedAt") AND isfinite("heartbeatAt") AND isfinite("leaseExpiresAt")
    AND "heartbeatAt" >= "claimedAt" AND "leaseExpiresAt" > "heartbeatAt"
    AND ("completedAt" IS NULL OR (isfinite("completedAt") AND "completedAt" >= "heartbeatAt"))
    AND ("status" = 'running') = ("completedAt" IS NULL)
    AND ("status" <> 'succeeded' OR "completedAt" < "leaseExpiresAt")
    AND ("status" <> 'expired' OR "completedAt" >= "leaseExpiresAt")
    AND CASE WHEN "status" IN ('failed', 'expired')
      THEN "errorCode" IS NOT NULL AND "errorCode" ~ '^[A-Z][A-Z0-9_]{0,63}$' AND "retryable" IS NOT NULL
      ELSE "errorCode" IS NULL AND "retryable" IS NULL END
);
ALTER TABLE "AnalysisManifest" ADD CONSTRAINT "AnalysisManifest_envelope_check" CHECK ((
    "checksum" ~ '^sha256:[a-f0-9]{64}$' AND length(btrim("dataVersion")) > 0
    AND jsonb_typeof("content") = 'object' AND "content"->>'schemaVersion' = 'research-manifest-1'
    AND "content"->>'id' = "id" AND "content"->>'jobId' = "jobId"
    AND "content"->>'workspaceId' = "workspaceId" AND "content"->>'dataVersion' = "dataVersion"
) IS TRUE);
ALTER TABLE "AnalysisResult" ADD CONSTRAINT "AnalysisResult_envelope_check" CHECK ((
    isfinite("generatedAt") AND isfinite("publishedAt") AND "generatedAt" <= "publishedAt"
    AND length(btrim("dataVersion")) > 0 AND jsonb_typeof("payload") = 'object'
    AND "payload"->>'schemaVersion' = 'research-2' AND "payload"->>'id' = "id"
    AND "payload"->>'jobId' = "jobId" AND "payload"->>'workspaceId' = "workspaceId"
    AND "payload"->>'dataVersion' = "dataVersion" AND "payload"->'method'->>'manifestId' = "manifestId"
    AND ("payload"->>'generatedAt')::timestamptz = "generatedAt"
    AND ("payload"->>'publishedAt')::timestamptz = "publishedAt"
) IS TRUE);
ALTER TABLE "AnalysisArtifact" ADD CONSTRAINT "AnalysisArtifact_storage_check" CHECK (
    "checksum" ~ '^sha256:[a-f0-9]{64}$' AND "bytes" BETWEEN 0 AND 9007199254740991
    AND length("objectKey") BETWEEN 1 AND 500
    AND "objectKey" ~ '^[A-Za-z0-9_-]+(/[A-Za-z0-9_.-]+)*$'
    AND "objectKey" !~ '(^|/)\.{1,2}(/|$)'
    AND "periodRole" IN ('primary', 'comparison') AND "format" IN ('parquet', 'json', 'geojson')
);
ALTER TABLE "MonitoringLocation" ADD CONSTRAINT "MonitoringLocation_evidence_check" CHECK ((
    length(btrim("name")) BETWEEN 1 AND 200 AND "areaRevision" > 0 AND isfinite("createdAt")
    AND "requestHash" ~ '^sha256:[a-f0-9]{64}$'
    AND jsonb_typeof("createdBy") = 'object' AND "createdBy"->>'id' = "createdById"
    AND jsonb_typeof("anchor") = 'object' AND "anchor"->>'id' = "anchorDetectionId"
    AND length(btrim("anchorDetectionId")) > 0
    AND jsonb_typeof("anchor"->'coordinates') = 'array' AND jsonb_array_length("anchor"->'coordinates') = 2
    AND jsonb_typeof("anchor"->'coordinates'->0) = 'number'
    AND jsonb_typeof("anchor"->'coordinates'->1) = 'number'
    AND ("anchor"->'coordinates'->>0)::numeric BETWEEN -180 AND 180
    AND ("anchor"->'coordinates'->>1)::numeric BETWEEN -90 AND 90
) IS TRUE);
ALTER TABLE "MonitoringLocationAnalysis" ADD CONSTRAINT "MonitoringLocationAnalysis_time_check" CHECK (isfinite("createdAt"));

CREATE FUNCTION "r2_preserve_history"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'R2 history is immutable';
END;
$$;

CREATE FUNCTION "r2_guard_job"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW."status" <> 'queued' THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'New job must be queued';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD."status" IN ('succeeded', 'failed') OR
       ROW(NEW."id", NEW."workspaceId", NEW."requestedById", NEW."requestId", NEW."analysisKey",
           NEW."areaId", NEW."areaRevision", NEW."input", NEW."createdAt") IS DISTINCT FROM
       ROW(OLD."id", OLD."workspaceId", OLD."requestedById", OLD."requestId", OLD."analysisKey",
           OLD."areaId", OLD."areaRevision", OLD."input", OLD."createdAt") OR
       (OLD."startedAt" IS NOT NULL AND NEW."startedAt" IS DISTINCT FROM OLD."startedAt") OR
       NOT ((OLD."status" = 'queued' AND NEW."status" IN ('running', 'failed')) OR
            (OLD."status" = 'running' AND NEW."status" IN ('running', 'succeeded', 'failed'))) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invalid job transition or rewritten input';
    END IF;
    IF NEW."status" = 'succeeded' AND NOT EXISTS (
        SELECT 1 FROM "AnalysisResult" r JOIN "AnalysisJobAttempt" a
          ON a."jobId" = r."jobId" AND a."workspaceId" = r."workspaceId"
        WHERE r."id" = NEW."resultId" AND r."jobId" = NEW."id" AND r."workspaceId" = NEW."workspaceId"
          AND a."status" = 'succeeded' AND a."completedAt" <= r."publishedAt"
          AND r."generatedAt" >= a."claimedAt" AND r."publishedAt" < a."leaseExpiresAt"
          AND NEW."completedAt" >= r."publishedAt"
          AND NOT EXISTS (SELECT 1 FROM "AnalysisJobAttempt" newer
              WHERE newer."jobId" = a."jobId" AND newer."attemptNo" > a."attemptNo")
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Success requires a matching result and completed attempt';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "AnalysisJob_lifecycle" BEFORE INSERT OR UPDATE ON "AnalysisJob"
FOR EACH ROW EXECUTE FUNCTION "r2_guard_job"();

CREATE FUNCTION "r2_guard_attempt"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status "AnalysisJobStatus";
BEGIN
    -- Serialize claims for the same job. Worker transactions must lock job before attempt.
    SELECT "status" INTO parent_status FROM "AnalysisJob"
      WHERE "id" = NEW."jobId" AND "workspaceId" = NEW."workspaceId" FOR UPDATE;
    IF parent_status IS NULL THEN RETURN NEW; END IF; -- Let the FK report missing scope.
    IF parent_status <> 'running' THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Attempt requires a running job';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW."status" <> 'running' OR EXISTS (
            SELECT 1 FROM "AnalysisJobAttempt" WHERE "jobId" = NEW."jobId"
              AND ("status" = 'running' OR "attemptNo" >= NEW."attemptNo")
        ) THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Attempt sequence must increase with only one running owner';
        END IF;
    ELSIF OLD."status" <> 'running' OR
        ROW(NEW."id", NEW."jobId", NEW."workspaceId", NEW."attemptNo", NEW."leaseToken", NEW."claimedAt") IS DISTINCT FROM
        ROW(OLD."id", OLD."jobId", OLD."workspaceId", OLD."attemptNo", OLD."leaseToken", OLD."claimedAt") OR
        NEW."heartbeatAt" < OLD."heartbeatAt" OR NEW."leaseExpiresAt" < OLD."leaseExpiresAt" THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Attempt identity and terminal history are immutable';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER "AnalysisJobAttempt_lifecycle" BEFORE INSERT OR UPDATE ON "AnalysisJobAttempt"
FOR EACH ROW EXECUTE FUNCTION "r2_guard_attempt"();

CREATE FUNCTION "r2_guard_evidence_insert"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j "AnalysisJob"; r "AnalysisResult"; m "AnalysisManifest";
BEGIN
    IF TG_TABLE_NAME IN ('AnalysisManifest', 'AnalysisResult') THEN
        SELECT * INTO j FROM "AnalysisJob" WHERE "id" = NEW."jobId" AND "workspaceId" = NEW."workspaceId" FOR UPDATE;
        IF j."id" IS NULL THEN RETURN NEW; END IF;
        IF j."status" <> 'running' THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Evidence requires an unpublished running job';
        END IF;
        IF TG_TABLE_NAME = 'AnalysisResult' THEN
            SELECT * INTO m FROM "AnalysisManifest" WHERE "id" = NEW."manifestId" AND "jobId" = NEW."jobId" AND "workspaceId" = NEW."workspaceId";
            IF m."id" IS NULL THEN RETURN NEW; END IF;
            IF NEW."dataVersion" <> m."dataVersion" OR NEW."dataVersion" <> j."input"->'versions'->>'dataVersion' OR
               NEW."payload"->'area' IS DISTINCT FROM j."input"->'area' OR
               NEW."payload"->'primary'->'period' IS DISTINCT FROM j."input"->'request'->'period' THEN
                RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Result differs from frozen input or manifest';
            END IF;
        END IF;
    ELSIF TG_TABLE_NAME = 'AnalysisArtifact' THEN
        SELECT * INTO r FROM "AnalysisResult" WHERE "id" = NEW."resultId" AND "workspaceId" = NEW."workspaceId";
        IF r."id" IS NULL THEN RETURN NEW; END IF;
        SELECT * INTO j FROM "AnalysisJob" WHERE "id" = r."jobId" FOR UPDATE;
        IF j."status" <> 'running' OR (NEW."periodRole" = 'comparison' AND r."payload"->'comparison' = 'null'::jsonb) THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Artifact scope is not open for publication';
        END IF;
    ELSE
        IF TG_TABLE_NAME = 'MonitoringLocation' THEN
            SELECT * INTO r FROM "AnalysisResult" WHERE "id" = NEW."initialAnalysisId" AND "workspaceId" = NEW."workspaceId";
        ELSE
            SELECT * INTO r FROM "AnalysisResult" WHERE "id" = NEW."analysisId" AND "workspaceId" = NEW."workspaceId";
        END IF;
        IF r."id" IS NULL THEN RETURN NEW; END IF;
        SELECT * INTO j FROM "AnalysisJob" WHERE "id" = r."jobId";
        IF j."status" <> 'succeeded' OR j."resultId" IS DISTINCT FROM r."id" THEN
            RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Location evidence requires a published result';
        END IF;
        IF TG_TABLE_NAME = 'MonitoringLocation' THEN
            IF NEW."areaId" IS DISTINCT FROM r."payload"->'area'->>'id' OR
               to_jsonb(NEW."areaRevision") IS DISTINCT FROM r."payload"->'area'->'revision' THEN
                RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Location must retain the original AOI revision';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['AnalysisJob', 'AnalysisJobAttempt', 'AnalysisManifest', 'AnalysisResult',
                             'AnalysisArtifact', 'MonitoringLocation', 'MonitoringLocationAnalysis'] LOOP
        EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION "r2_preserve_history"()', t || '_no_delete', t);
        EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION "r2_preserve_history"()', t || '_no_truncate', t);
        IF t NOT IN ('AnalysisJob', 'AnalysisJobAttempt') THEN
            EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION "r2_preserve_history"()', t || '_no_update', t);
            EXECUTE format('CREATE TRIGGER %I BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION "r2_guard_evidence_insert"()', t || '_evidence', t);
        END IF;
    END LOOP;
END;
$$;

COMMIT;

