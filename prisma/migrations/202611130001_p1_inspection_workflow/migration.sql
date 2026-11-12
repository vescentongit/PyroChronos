BEGIN;

CREATE TYPE "P1InspectionAssignmentStatus" AS ENUM ('assigned','in_progress','completed','cancelled');
CREATE TYPE "P1InspectionOutcome" AS ENUM ('fire_or_smoke_found','no_sign_at_inspection','inconclusive');
CREATE TYPE "P1InspectionAuditAction" AS ENUM ('assignment_created','assignment_status_changed','report_created','report_corrected');

CREATE TABLE "InspectionAssignment" (
  id TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "locationId" TEXT NOT NULL,
  "requestId" UUID NOT NULL, "assigneeUserId" TEXT NOT NULL, assignee JSONB NOT NULL,
  "assignedById" TEXT NOT NULL, "assignedBy" JSONB NOT NULL,
  status "P1InspectionAssignmentStatus" NOT NULL DEFAULT 'assigned', revision INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InspectionAssignment_scope_key" UNIQUE(id,"locationId","workspaceId"),
  CONSTRAINT "InspectionAssignment_request_key" UNIQUE("locationId","assignedById","requestId"),
  CONSTRAINT "InspectionAssignment_location_fkey" FOREIGN KEY("locationId","workspaceId") REFERENCES "MonitoringLocation"(id,"workspaceId") ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT "InspectionAssignment_assignee_fkey" FOREIGN KEY("workspaceId","assigneeUserId") REFERENCES "Membership"("workspaceId","userId") ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT "InspectionAssignment_assigner_fkey" FOREIGN KEY("workspaceId","assignedById") REFERENCES "Membership"("workspaceId","userId") ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (revision>0 AND isfinite("createdAt") AND isfinite("updatedAt") AND "updatedAt">="createdAt")
);
CREATE INDEX "InspectionAssignment_list_idx" ON "InspectionAssignment"("workspaceId","locationId","createdAt",id);

CREATE TABLE "P1InspectionReport" (
  id TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "locationId" TEXT NOT NULL, "assignmentId" TEXT NOT NULL,
  "requestId" UUID NOT NULL, "inspectorUserId" TEXT NOT NULL, inspector JSONB NOT NULL,
  "observedAt" TIMESTAMPTZ(3) NOT NULL, outcome "P1InspectionOutcome" NOT NULL, notes TEXT NOT NULL,
  "recordedById" TEXT NOT NULL, "recordedBy" JSONB NOT NULL, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "P1InspectionReport_identity_key" UNIQUE(id,"workspaceId"),
  CONSTRAINT "P1InspectionReport_scope_key" UNIQUE(id,"assignmentId","locationId","workspaceId"),
  CONSTRAINT "P1InspectionReport_request_key" UNIQUE("assignmentId","recordedById","requestId"),
  CONSTRAINT "P1InspectionReport_assignment_fkey" FOREIGN KEY("assignmentId","locationId","workspaceId") REFERENCES "InspectionAssignment"(id,"locationId","workspaceId") ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT "P1InspectionReport_inspector_fkey" FOREIGN KEY("workspaceId","inspectorUserId") REFERENCES "Membership"("workspaceId","userId") ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT "P1InspectionReport_recorder_fkey" FOREIGN KEY("workspaceId","recordedById") REFERENCES "Membership"("workspaceId","userId") ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (length(notes)<=2000 AND isfinite("observedAt") AND isfinite("createdAt"))
);
CREATE INDEX "P1InspectionReport_list_idx" ON "P1InspectionReport"("workspaceId","locationId","createdAt",id);

CREATE TABLE "P1InspectionReportRevision" (
  id TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "reportId" TEXT NOT NULL, revision INTEGER NOT NULL,
  "requestId" UUID NOT NULL, reason TEXT NOT NULL, "inspectorUserId" TEXT NOT NULL, inspector JSONB NOT NULL,
  "observedAt" TIMESTAMPTZ(3) NOT NULL, outcome "P1InspectionOutcome" NOT NULL, notes TEXT NOT NULL,
  "correctedById" TEXT NOT NULL, "correctedBy" JSONB NOT NULL, "correctedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "P1InspectionReportRevision_sequence_key" UNIQUE("reportId",revision),
  CONSTRAINT "P1InspectionReportRevision_request_key" UNIQUE("reportId","correctedById","requestId"),
  CONSTRAINT "P1InspectionReportRevision_report_fkey" FOREIGN KEY("reportId","workspaceId") REFERENCES "P1InspectionReport"(id,"workspaceId") ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT "P1InspectionReportRevision_inspector_fkey" FOREIGN KEY("workspaceId","inspectorUserId") REFERENCES "Membership"("workspaceId","userId") ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT "P1InspectionReportRevision_corrector_fkey" FOREIGN KEY("workspaceId","correctedById") REFERENCES "Membership"("workspaceId","userId") ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK (revision>1 AND length(btrim(reason)) BETWEEN 1 AND 500 AND length(notes)<=2000 AND isfinite("observedAt") AND isfinite("correctedAt"))
);

CREATE TABLE "InspectionAuditEvent" (
  id TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "locationId" TEXT NOT NULL, "assignmentId" TEXT NOT NULL, "reportId" TEXT,
  action "P1InspectionAuditAction" NOT NULL, "requestId" UUID NOT NULL, "actorId" TEXT NOT NULL, actor JSONB NOT NULL,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "fromRevision" INTEGER, "toRevision" INTEGER NOT NULL,
  "fromStatus" "P1InspectionAssignmentStatus", "toStatus" "P1InspectionAssignmentStatus",
  CONSTRAINT "InspectionAuditEvent_assignment_fkey" FOREIGN KEY("assignmentId","locationId","workspaceId") REFERENCES "InspectionAssignment"(id,"locationId","workspaceId") ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT "InspectionAuditEvent_report_fkey" FOREIGN KEY("reportId","assignmentId","locationId","workspaceId") REFERENCES "P1InspectionReport"(id,"assignmentId","locationId","workspaceId") ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT "InspectionAuditEvent_actor_fkey" FOREIGN KEY("workspaceId","actorId") REFERENCES "Membership"("workspaceId","userId") ON UPDATE RESTRICT ON DELETE RESTRICT,
  CHECK ("toRevision">0 AND isfinite("occurredAt") AND ("fromRevision" IS NULL OR "fromRevision">0)),
  CHECK ((action IN ('assignment_created','assignment_status_changed') AND "reportId" IS NULL AND "toStatus" IS NOT NULL)
    OR (action IN ('report_created','report_corrected') AND "reportId" IS NOT NULL AND "fromStatus" IS NULL AND "toStatus" IS NULL))
);
CREATE INDEX "InspectionAuditEvent_list_idx" ON "InspectionAuditEvent"("workspaceId","locationId","occurredAt",id);
CREATE UNIQUE INDEX "InspectionAuditEvent_assignment_revision_key" ON "InspectionAuditEvent"("assignmentId","toRevision") WHERE "reportId" IS NULL;
CREATE UNIQUE INDEX "InspectionAuditEvent_report_revision_key" ON "InspectionAuditEvent"("reportId","toRevision") WHERE "reportId" IS NOT NULL;

CREATE FUNCTION r2_inspection_actor(snapshot JSONB, identity TEXT) RETURNS BOOLEAN LANGUAGE sql IMMUTABLE AS $$
  SELECT (jsonb_typeof(snapshot)='object' AND snapshot->>'id'=identity
    AND snapshot ? 'displayName' AND jsonb_typeof(snapshot->'displayName') IN ('string','null')
    AND snapshot - ARRAY['id','displayName']='{}'::jsonb) IS TRUE;
$$;
ALTER TABLE "InspectionAssignment" ADD CHECK(r2_inspection_actor(assignee,"assigneeUserId") AND r2_inspection_actor("assignedBy","assignedById"));
ALTER TABLE "P1InspectionReport" ADD CHECK(r2_inspection_actor(inspector,"inspectorUserId") AND r2_inspection_actor("recordedBy","recordedById"));
ALTER TABLE "P1InspectionReportRevision" ADD CHECK(r2_inspection_actor(inspector,"inspectorUserId") AND r2_inspection_actor("correctedBy","correctedById"));
ALTER TABLE "InspectionAuditEvent" ADD CHECK(r2_inspection_actor(actor,"actorId"));

CREATE FUNCTION r2_inspection_assignment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'assigned' OR NEW.revision<>1 OR NEW."updatedAt"<>NEW."createdAt" THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invalid initial assignment';
    END IF;
  ELSE
    IF ROW(NEW.id,NEW."workspaceId",NEW."locationId",NEW."requestId",NEW."assigneeUserId",NEW.assignee,NEW."assignedById",NEW."assignedBy",NEW."createdAt")
      IS DISTINCT FROM ROW(OLD.id,OLD."workspaceId",OLD."locationId",OLD."requestId",OLD."assigneeUserId",OLD.assignee,OLD."assignedById",OLD."assignedBy",OLD."createdAt")
      OR NEW.revision<>OLD.revision+1 OR NEW."updatedAt"<OLD."updatedAt"
      OR NOT ((OLD.status='assigned' AND NEW.status IN ('in_progress','completed','cancelled')) OR (OLD.status='in_progress' AND NEW.status IN ('completed','cancelled')))
      OR (NEW.status='completed' AND NOT EXISTS(SELECT 1 FROM "P1InspectionReport" WHERE "assignmentId"=NEW.id)) THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invalid assignment transition';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "InspectionAssignment_guard" BEFORE INSERT OR UPDATE ON "InspectionAssignment" FOR EACH ROW EXECUTE FUNCTION r2_inspection_assignment_guard();

CREATE FUNCTION r2_inspection_report_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a "InspectionAssignment"; r "P1InspectionReport"; previous INTEGER; last_time TIMESTAMPTZ;
BEGIN
  IF NEW."observedAt">clock_timestamp() THEN
    RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Future inspection time';
  END IF;
  IF TG_TABLE_NAME='P1InspectionReport' THEN
    SELECT * INTO a FROM "InspectionAssignment" WHERE id=NEW."assignmentId" FOR UPDATE;
    IF a.id IS NOT NULL AND a.status NOT IN ('assigned','in_progress') THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Assignment is terminal';
    END IF;
  ELSE
    SELECT * INTO r FROM "P1InspectionReport" WHERE id=NEW."reportId" FOR UPDATE;
    SELECT COALESCE(max(revision),1), COALESCE(max("correctedAt"),r."createdAt") INTO previous,last_time
      FROM "P1InspectionReportRevision" WHERE "reportId"=NEW."reportId";
    IF NEW.revision<>previous+1 OR NEW."correctedAt"<last_time THEN
      RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invalid inspection revision';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "P1InspectionReport_guard" BEFORE INSERT ON "P1InspectionReport" FOR EACH ROW EXECUTE FUNCTION r2_inspection_report_guard();
CREATE TRIGGER "P1InspectionReportRevision_guard" BEFORE INSERT ON "P1InspectionReportRevision" FOR EACH ROW EXECUTE FUNCTION r2_inspection_report_guard();

CREATE FUNCTION r2_inspection_require_audit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE found BOOLEAN;
BEGIN
  IF TG_TABLE_NAME='InspectionAssignment' THEN
    SELECT EXISTS(SELECT 1 FROM "InspectionAuditEvent" e WHERE e."assignmentId"=NEW.id AND e."reportId" IS NULL
      AND e."toRevision"=NEW.revision AND e."toStatus"=NEW.status AND e."occurredAt"=NEW."updatedAt") INTO found;
  ELSIF TG_TABLE_NAME='P1InspectionReport' THEN
    SELECT EXISTS(SELECT 1 FROM "InspectionAuditEvent" e WHERE e."reportId"=NEW.id AND e.action='report_created'
      AND e."toRevision"=1 AND e."requestId"=NEW."requestId" AND e."actorId"=NEW."recordedById" AND e."occurredAt"=NEW."createdAt") INTO found;
  ELSE
    SELECT EXISTS(SELECT 1 FROM "InspectionAuditEvent" e WHERE e."reportId"=NEW."reportId" AND e.action='report_corrected'
      AND e."toRevision"=NEW.revision AND e."requestId"=NEW."requestId" AND e."actorId"=NEW."correctedById" AND e."occurredAt"=NEW."correctedAt") INTO found;
  END IF;
  IF NOT found THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Inspection audit required'; END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER "InspectionAssignment_audit_required" AFTER INSERT OR UPDATE ON "InspectionAssignment" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION r2_inspection_require_audit();
CREATE CONSTRAINT TRIGGER "P1InspectionReport_audit_required" AFTER INSERT ON "P1InspectionReport" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION r2_inspection_require_audit();
CREATE CONSTRAINT TRIGGER "P1InspectionReportRevision_audit_required" AFTER INSERT ON "P1InspectionReportRevision" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION r2_inspection_require_audit();

CREATE FUNCTION r2_inspection_audit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a "InspectionAssignment"; r "P1InspectionReport"; v "P1InspectionReportRevision"; p "InspectionAuditEvent"; valid BOOLEAN:=false; owner_role BOOLEAN;
BEGIN
  SELECT * INTO a FROM "InspectionAssignment" WHERE id=NEW."assignmentId";
  SELECT role='owner' INTO owner_role FROM "Membership" WHERE "workspaceId"=NEW."workspaceId" AND "userId"=NEW."actorId" AND active;
  IF owner_role IS NULL THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Inactive inspection actor'; END IF;
  IF NEW.action='assignment_created' THEN
    valid:=NEW."fromRevision" IS NULL AND NEW."fromStatus" IS NULL AND NEW."toRevision"=1 AND NEW."toStatus"='assigned'
      AND NEW."actorId"=a."assignedById" AND NEW.actor=a."assignedBy" AND NEW."requestId"=a."requestId" AND NEW."occurredAt"=a."createdAt";
  ELSIF NEW.action='assignment_status_changed' THEN
    SELECT * INTO p FROM "InspectionAuditEvent" WHERE "assignmentId"=a.id AND "reportId" IS NULL AND "toRevision"=NEW."fromRevision";
    valid:=p.id IS NOT NULL AND NEW."toRevision"=NEW."fromRevision"+1 AND NEW."fromStatus"=p."toStatus" AND NEW."occurredAt">=p."occurredAt"
      AND (NEW."actorId" IN (a."assignedById",a."assigneeUserId") OR owner_role)
      AND ((NEW."fromStatus"='assigned' AND NEW."toStatus" IN ('in_progress','completed','cancelled')) OR (NEW."fromStatus"='in_progress' AND NEW."toStatus" IN ('completed','cancelled')));
  ELSIF NEW.action='report_created' THEN
    SELECT * INTO r FROM "P1InspectionReport" WHERE id=NEW."reportId";
    valid:=r.id IS NOT NULL AND NEW."fromRevision" IS NULL AND NEW."toRevision"=1
      AND NEW."actorId"=r."recordedById" AND NEW.actor=r."recordedBy" AND NEW."requestId"=r."requestId" AND NEW."occurredAt"=r."createdAt";
  ELSE
    SELECT * INTO r FROM "P1InspectionReport" WHERE id=NEW."reportId";
    SELECT * INTO v FROM "P1InspectionReportRevision" WHERE "reportId"=NEW."reportId" AND revision=NEW."toRevision";
    valid:=v.id IS NOT NULL AND NEW."fromRevision"=v.revision-1 AND NEW."requestId"=v."requestId"
      AND NEW."actorId"=v."correctedById" AND NEW.actor=v."correctedBy" AND NEW."occurredAt"=v."correctedAt" AND (NEW."actorId"=r."recordedById" OR owner_role);
  END IF;
  IF NEW."reportId" IS NULL THEN
    valid:=valid AND NEW."toRevision"<=a.revision AND (NEW."toRevision"<>a.revision OR NEW."toStatus"=a.status);
  END IF;
  IF valid IS DISTINCT FROM true THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Invalid inspection audit'; END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER "InspectionAuditEvent_guard" AFTER INSERT ON "InspectionAuditEvent" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION r2_inspection_audit_guard();

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['InspectionAssignment','P1InspectionReport','P1InspectionReportRevision','InspectionAuditEvent'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH ROW EXECUTE FUNCTION r2_preserve_history()', t || '_no_delete',t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION r2_preserve_history()', t || '_no_truncate',t);
    IF t<>'InspectionAssignment' THEN
      EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION r2_preserve_history()', t || '_no_update',t);
    END IF;
  END LOOP;
END;
$$;
COMMIT;
