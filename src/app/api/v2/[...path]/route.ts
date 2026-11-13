import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { researchDb } from "@/lib/research-db";
import { createResearchWorkspaceSchema, createResearchAreaSchema, createResearchAnalysisSchema, updateResearchMembershipSchema } from "@/lib/research-contracts";
import { areaWire, createArea, cursorRead, cursorWrite, errorPayload, fail, getArea, getArtifact, getJobRow, idempotent, jobWire, member, membershipWire, ResearchFailure, resultWire, rolePeriod, submitAnalysis, workspaceLock, workspaceWire } from "@/lib/research-store";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
type Context = { params: Promise<{ path: string[] }> };
async function handle(req: NextRequest, context: Context) {
  try {
    // The queue worker and authorization integration tests are not yet complete.
    if (process.env.RESEARCH_V2_EXPERIMENTAL !== "true") fail("DEPENDENCY_UNAVAILABLE", 503);
    const session = await auth();
    const user = session?.user?.id ?? fail("UNAUTHENTICATED", 401);
    const path = (await context.params).path;
    const db = researchDb();
    const method = req.method;
    if (method !== "GET") {
      const origin = req.headers.get("origin");
      if (origin && origin !== req.nextUrl.origin) fail("FORBIDDEN", 403);
    }
    const body = method === "GET" ? null : await req.json().catch(() => fail("INVALID_REQUEST"));
    const parse = (schema: any) => { const result = schema.safeParse(body); if (!result.success) fail("INVALID_REQUEST"); return result.data; };
    let value: any, status = 200;
    if (path.length === 1 && path[0] === "workspaces") {
      if (method === "GET") {
        const rows = await db.query('SELECT w.*,u.name AS "creatorName" FROM "Workspace" w JOIN "Membership" m ON m."workspaceId"=w.id JOIN "User" u ON u.id=w."createdById" WHERE m."userId"=$1 AND m.active=true ORDER BY w.id LIMIT 100', [user]);
        value = { items: rows.map(workspaceWire), nextCursor: null };
      } else if (method === "POST") {
        const input = parse(createResearchWorkspaceSchema);
        ({ value, status } = await db.transaction(tx => idempotent(tx, `workspace:${user}`, input.requestId, input, async () => {
          const [row] = await tx.query('INSERT INTO "Workspace" (id,name,"createdById") VALUES ($1,$2,$3) RETURNING *', [randomUUID(), input.name, user]);
          await tx.query('INSERT INTO "Membership" ("workspaceId","userId",role) VALUES ($1,$2,\'owner\')', [row.id, user]);
          return { value: workspaceWire({ ...row, creatorName: session?.user?.name }), status: 201 };
        })));
      } else fail("NOT_FOUND", 404);
    } else {
      if (path[0] !== "workspaces" || !path[1]) fail("NOT_FOUND", 404);
      const workspace = path[1], resource = path[2], id = path[3];
      await member(db, workspace, user);
      if (method === "GET" && resource === "members" && !id) {
        const rows = await db.query('SELECT m.*,u.name FROM "Membership" m JOIN "User" u ON u.id=m."userId" WHERE m."workspaceId"=$1 ORDER BY m."userId" LIMIT 100', [workspace]);
        value = { items: rows.map(membershipWire), nextCursor: null };
      } else if (method === "PUT" && resource === "members" && id) {
        const input = parse(updateResearchMembershipSchema);
        ({ value, status } = await db.transaction(async tx => {
          await workspaceLock(tx, workspace); await member(tx, workspace, user, true);
          return idempotent(tx, `membership:${workspace}:${user}:${id}`, input.requestId, input, async () => {
            const [existing] = await tx.query('SELECT * FROM "Membership" WHERE "workspaceId"=$1 AND "userId"=$2', [workspace, id]);
            if ((existing?.revision ?? null) !== input.expectedRevision) fail("REVISION_CONFLICT", 409);
            const [target] = await tx.query('SELECT id,name FROM "User" WHERE id=$1', [id]);
            if (!target) fail("NOT_FOUND", 404);
            if (existing?.role === "owner" && existing.active && (input.role !== "owner" || !input.active)) {
              const [{ count }] = await tx.query('SELECT count(*)::int AS count FROM "Membership" WHERE "workspaceId"=$1 AND role=\'owner\' AND active=true', [workspace]);
              if (count <= 1) fail("REVISION_CONFLICT", 409);
            }
            const [row] = existing ? await tx.query('UPDATE "Membership" SET role=$3,active=$4,revision=revision+1 WHERE "workspaceId"=$1 AND "userId"=$2 RETURNING *', [workspace, id, input.role, input.active]) : await tx.query('INSERT INTO "Membership" ("workspaceId","userId",role,active) VALUES ($1,$2,$3,$4) RETURNING *', [workspace, id, input.role, input.active]);
            return { value: membershipWire({ ...row, name: target.name }), status: existing ? 200 : 201 };
          });
        }));
      } else if (resource === "areas" && method === "POST" && !id) {
        const input = parse(createResearchAreaSchema);
        ({ value, status } = await db.transaction(async tx => {
          await workspaceLock(tx, workspace); await member(tx, workspace, user);
          return idempotent(tx, `area:${workspace}:${user}`, input.requestId, input, async () => ({ value: await createArea(tx, workspace, input), status: 201 }));
        }));
      } else if (resource === "areas" && method === "GET") {
        if (id) value = await getArea(db, workspace, id);
        else {
          const scope = `areas:${workspace}`, after = cursorRead(req.nextUrl.searchParams.get("cursor"), scope) ?? "";
          if (typeof after !== "string") fail("INVALID_REQUEST");
          const rows = await db.query('SELECT * FROM "AnalysisArea" WHERE "workspaceId"=$1 AND id>$2 ORDER BY id LIMIT 51', [workspace, after]);
          value = { items: rows.slice(0, 50).map(areaWire), nextCursor: rows.length > 50 ? cursorWrite(scope, rows[49].id) : null };
        }
      } else if (resource === "analyses" && method === "POST" && !id) {
        const input = parse(createResearchAnalysisSchema);
        ({ value, status } = await submitAnalysis(db, workspace, user, input));
      } else if (resource === "jobs" && id && method === "GET") value = jobWire(await getJobRow(db, workspace, id));
      else if (resource === "analyses" && id && method === "GET") {
        const { job, artifact } = await getArtifact(db, workspace, id);
        const result = resultWire(job, artifact);
        if (!path[4]) value = result;
        else {
          const role = req.nextUrl.searchParams.get("periodRole") ?? "";
          rolePeriod(result, role);
          if (path[4] === "days") {
            const month = req.nextUrl.searchParams.get("month");
            const page = artifact.days.find((p: any) => p.periodRole === role && p.month === month);
            if (!page) fail("NOT_FOUND", 404);
            value = { ...page, analysisId: id };
          } else if (path[4] === "detections") {
            const scope = `detections:${workspace}:${id}:${role}`;
            const after = cursorRead(req.nextUrl.searchParams.get("cursor"), scope) ?? -1;
            if (typeof after !== "number" || after < -1) fail("INVALID_REQUEST");
            const rows = await db.query('SELECT ordinal,payload FROM "ResearchObservation" WHERE "runId"=$1 AND "periodRole"=$2 AND ordinal>$3 ORDER BY ordinal LIMIT 1001', [job.runId, role, after]);
            value = { schemaVersion: "research-2", analysisId: id, periodRole: role, observations: rows.slice(0, 1000).map(row => row.payload), nextCursor: rows.length > 1000 ? cursorWrite(scope, rows[999].ordinal) : null };
          } else if (path[4] === "tiles" && path[5] === "raw-density" && path.length === 9) {
            const [z, x, y] = path.slice(6).map(Number);
            if (![z, x, y].every(Number.isInteger) || z < 0 || z > 16 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) fail("INVALID_REQUEST");
            const [cached] = await db.query('SELECT payload FROM "ResearchTile" WHERE "runId"=$1 AND "periodRole"=$2 AND z=$3 AND x=$4 AND y=$5', [job.runId, role, z, x, y]);
            if (cached) value = cached.payload;
            else {
              const n = 2 ** z, west = x / n * 360 - 180, east = (x + 1) / n * 360 - 180;
              const latitude = (v: number) => Math.atan(Math.sinh(Math.PI * (1 - 2 * v / n))) * 180 / Math.PI;
              const south = latitude(y + 1), north = latitude(y);
              const points = await db.query('SELECT longitude,latitude FROM "ResearchObservation" WHERE "runId"=$1 AND "periodRole"=$2 AND longitude >= $3 AND longitude < $4 AND latitude >= $5 AND latitude < $6', [job.runId, role, west, east, south, north]);
              const bins = new Map<string, { longitude: number; latitude: number; count: number }>();
              for (const point of points) {
                const column = Math.min(31, Math.floor((point.longitude - west) / (east - west) * 32));
                const row = Math.min(31, Math.floor((point.latitude - south) / (north - south) * 32));
                const key = `${column}:${row}`, old = bins.get(key);
                if (old) old.count++;
                else bins.set(key, { longitude: west + (column + 0.5) * (east - west) / 32, latitude: south + (row + 0.5) * (north - south) / 32, count: 1 });
              }
              value = { type: "FeatureCollection", unit: "original-detection-count", features: [...bins.values()].map(bin => ({ type: "Feature", geometry: { type: "Point", coordinates: [bin.longitude, bin.latitude] }, properties: { count: bin.count } })) };
              await db.query('INSERT INTO "ResearchTile" ("runId","periodRole",z,x,y,payload) VALUES ($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT DO NOTHING RETURNING z', [job.runId, role, z, x, y, JSON.stringify(value)]);
            }
          } else fail("NOT_FOUND", 404);
        }
      } else fail("NOT_FOUND", 404);
    }
    return NextResponse.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const known = error instanceof ResearchFailure ? error : new ResearchFailure("INTERNAL_ERROR", 500);
    return NextResponse.json(errorPayload(known.code), { status: known.status, headers: { "Cache-Control": "private, no-store", ...(known.status === 429 ? { "Retry-After": "60" } : {}) } });
  }
}
export const GET = handle;
export const POST = handle;
export const PUT = handle;
