-- Additive migration: InspectionReport and the initial migration are untouched.
BEGIN;

CREATE TYPE "RawBatchStatus" AS ENUM ('PENDING', 'FETCHED', 'VALID', 'EMPTY', 'REJECTED', 'FAILED');
CREATE TYPE "FirmsProcessingLevel" AS ENUM ('NRT', 'STANDARD');

CREATE TABLE "RawBatch" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceManifestVersion" TEXT NOT NULL,
    "processingLevel" "FirmsProcessingLevel" NOT NULL,
    "productVersion" TEXT,
    "regionId" TEXT NOT NULL,
    "boundaryVersion" TEXT NOT NULL,
    "regionConfigChecksum" VARCHAR(64) NOT NULL,
    "requestBbox" JSONB NOT NULL,
    "requestedStart" TIMESTAMPTZ(3) NOT NULL,
    "requestedEnd" TIMESTAMPTZ(3) NOT NULL,
    "fetchStartedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fetchedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "checksumSha256" VARCHAR(64),
    "payloadRef" TEXT,
    "payloadBytes" BIGINT,
    "payloadFormat" TEXT NOT NULL DEFAULT 'csv',
    "status" "RawBatchStatus" NOT NULL DEFAULT 'PENDING',
    "httpStatus" INTEGER,
    "errorCode" TEXT,
    "retryable" BOOLEAN,
    "validatorVersion" TEXT,
    "rowCount" INTEGER,
    "validationSummary" JSONB,
    CONSTRAINT "RawBatch_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RawBatch_identity_check" CHECK (
        length(btrim("id")) > 0 AND length(btrim("sourceId")) > 0
        AND length(btrim("sourceManifestVersion")) > 0 AND length(btrim("regionId")) > 0
        AND length(btrim("boundaryVersion")) > 0 AND length(btrim("payloadFormat")) > 0
        AND ("productVersion" IS NULL OR length(btrim("productVersion")) > 0)
    ),
    CONSTRAINT "RawBatch_checksum_check" CHECK (
        "regionConfigChecksum" ~ '^[0-9a-f]{64}$'
        AND ("checksumSha256" IS NULL OR "checksumSha256" ~ '^[0-9a-f]{64}$')
    ),
    CONSTRAINT "RawBatch_bbox_check" CHECK ((
        CASE WHEN jsonb_typeof("requestBbox") = 'array' AND jsonb_array_length("requestBbox") = 4
        THEN jsonb_typeof("requestBbox"->0) = 'number' AND jsonb_typeof("requestBbox"->1) = 'number'
            AND jsonb_typeof("requestBbox"->2) = 'number' AND jsonb_typeof("requestBbox"->3) = 'number'
            AND ("requestBbox"->>0)::numeric >= -180 AND ("requestBbox"->>2)::numeric <= 180
            AND ("requestBbox"->>1)::numeric >= -90 AND ("requestBbox"->>3)::numeric <= 90
            AND ("requestBbox"->>0)::numeric < ("requestBbox"->>2)::numeric
            AND ("requestBbox"->>1)::numeric < ("requestBbox"->>3)::numeric
        ELSE false END
    ) IS TRUE),
    CONSTRAINT "RawBatch_time_check" CHECK (
        "requestedStart" < "requestedEnd"
        AND isfinite("requestedStart") AND isfinite("requestedEnd") AND isfinite("fetchStartedAt")
        AND ("fetchedAt" IS NULL OR (isfinite("fetchedAt") AND "fetchedAt" >= "fetchStartedAt"))
        AND ("completedAt" IS NULL OR (isfinite("completedAt") AND "completedAt" >= "fetchStartedAt"
            AND ("fetchedAt" IS NULL OR "completedAt" >= "fetchedAt")))
    ),
    -- A checksum identifies the exact stored bytes, not normalized CSV rows.
    -- Byte/hash verification against object storage belongs to the ingest writer.
    CONSTRAINT "RawBatch_payload_check" CHECK (
        ("payloadRef" IS NULL AND "checksumSha256" IS NULL AND "payloadBytes" IS NULL AND "fetchedAt" IS NULL)
        OR ("payloadRef" IS NOT NULL AND length(btrim("payloadRef")) > 0
            AND "checksumSha256" IS NOT NULL AND "payloadBytes" IS NOT NULL AND "payloadBytes" >= 0
            AND "fetchedAt" IS NOT NULL)
    ),
    CONSTRAINT "RawBatch_result_check" CHECK (
        ("rowCount" IS NULL OR "rowCount" >= 0)
        AND ("httpStatus" IS NULL OR "httpStatus" BETWEEN 100 AND 599)
        AND ("validatorVersion" IS NULL OR length(btrim("validatorVersion")) > 0)
        AND ("errorCode" IS NULL OR "errorCode" ~ '^[A-Z][A-Z0-9_]{0,63}$')
        AND ("validationSummary" IS NULL OR jsonb_typeof("validationSummary") = 'object')
    ),
    CONSTRAINT "RawBatch_status_check" CHECK ((
        CASE "status"
        WHEN 'PENDING' THEN "payloadRef" IS NULL AND "completedAt" IS NULL
            AND "errorCode" IS NULL AND "retryable" IS NULL AND "rowCount" IS NULL AND "validatorVersion" IS NULL
        WHEN 'FETCHED' THEN "payloadRef" IS NOT NULL AND "completedAt" IS NULL
            AND "errorCode" IS NULL AND "retryable" IS NULL AND "rowCount" IS NULL AND "validatorVersion" IS NULL
        WHEN 'VALID' THEN "payloadRef" IS NOT NULL AND "completedAt" IS NOT NULL
            AND "validatorVersion" IS NOT NULL AND "rowCount" IS NOT NULL AND "rowCount" > 0
            AND "errorCode" IS NULL AND "retryable" IS NULL
        WHEN 'EMPTY' THEN "payloadRef" IS NOT NULL AND "completedAt" IS NOT NULL
            AND "validatorVersion" IS NOT NULL AND "rowCount" IS NOT NULL AND "rowCount" = 0
            AND "errorCode" IS NULL AND "retryable" IS NULL
        WHEN 'REJECTED' THEN "payloadRef" IS NOT NULL AND "completedAt" IS NOT NULL
            AND "validatorVersion" IS NOT NULL AND "errorCode" IS NOT NULL AND "retryable" IS NOT NULL
        WHEN 'FAILED' THEN "completedAt" IS NOT NULL AND "errorCode" IS NOT NULL
            AND "retryable" IS NOT NULL AND "rowCount" IS NULL
        END
    ) IS TRUE)
);

-- Object references are write-once per attempt; identical checksums are allowed.
CREATE UNIQUE INDEX "RawBatch_payloadRef_key" ON "RawBatch"("payloadRef");
CREATE INDEX "RawBatch_regionId_sourceId_fetchedAt_idx" ON "RawBatch"("regionId", "sourceId", "fetchedAt");
CREATE INDEX "RawBatch_status_fetchStartedAt_idx" ON "RawBatch"("status", "fetchStartedAt");

CREATE FUNCTION "protect_raw_batch_history"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Raw batch history cannot be removed';
    END IF;
    IF OLD."status" IN ('VALID', 'EMPTY', 'REJECTED', 'FAILED') THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Terminal raw batch is immutable';
    END IF;
    IF ROW(OLD."id", OLD."sourceId", OLD."sourceManifestVersion", OLD."processingLevel", OLD."productVersion",
           OLD."regionId", OLD."boundaryVersion", OLD."regionConfigChecksum", OLD."requestBbox",
           OLD."requestedStart", OLD."requestedEnd", OLD."fetchStartedAt", OLD."payloadFormat")
       IS DISTINCT FROM
       ROW(NEW."id", NEW."sourceId", NEW."sourceManifestVersion", NEW."processingLevel", NEW."productVersion",
           NEW."regionId", NEW."boundaryVersion", NEW."regionConfigChecksum", NEW."requestBbox",
           NEW."requestedStart", NEW."requestedEnd", NEW."fetchStartedAt", NEW."payloadFormat") THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Raw batch request provenance is immutable';
    END IF;
    IF OLD."status" = 'FETCHED' AND
       ROW(OLD."fetchedAt", OLD."payloadRef", OLD."checksumSha256", OLD."payloadBytes", OLD."httpStatus")
       IS DISTINCT FROM
       ROW(NEW."fetchedAt", NEW."payloadRef", NEW."checksumSha256", NEW."payloadBytes", NEW."httpStatus") THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Fetched raw batch payload is immutable';
    END IF;
    IF NOT ((OLD."status" = 'PENDING' AND NEW."status" IN ('FETCHED', 'FAILED'))
         OR (OLD."status" = 'FETCHED' AND NEW."status" IN ('VALID', 'EMPTY', 'REJECTED', 'FAILED'))) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invalid raw batch status transition';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "RawBatch_protect_history"
BEFORE UPDATE OR DELETE ON "RawBatch"
FOR EACH ROW EXECUTE FUNCTION "protect_raw_batch_history"();

CREATE TRIGGER "RawBatch_protect_truncate"
BEFORE TRUNCATE ON "RawBatch"
FOR EACH STATEMENT EXECUTE FUNCTION "protect_raw_batch_history"();

COMMIT;
