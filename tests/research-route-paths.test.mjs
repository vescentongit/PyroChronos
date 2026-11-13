import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { NextRequest } from "next/server.js";

process.env.RESEARCH_V2_EXPERIMENTAL = "true";
globalThis.researchRouteTestDb = {
  query: async (sql) => {
    if (sql.includes('FROM "Membership"')) return [{ role: "member", active: true }];
    throw new Error("Unexpected database access");
  },
};
registerHooks({ resolve(specifier, context, next) {
  if (specifier === "@/auth") return { url: "data:text/javascript,export const auth=async()=>({user:{id:'user'}})", shortCircuit: true };
  if (specifier === "@/lib/research-db") return { url: "data:text/javascript,export const researchDb=()=>globalThis.researchRouteTestDb", shortCircuit: true };
  if (specifier.startsWith("@/")) return next(pathToFileURL(resolve("src", `${specifier.slice(2)}.ts`)).href, context);
  if (specifier === "next/server") return next("next/server.js", context);
  return next(specifier, context);
} });
const { GET, POST } = await import("../src/app/api/v2/[...path]/route.ts");

test("v2 rejects extra path segments instead of returning a different resource", async () => {
  for (const suffix of ["areas/id/extra", "jobs/id/extra", "members/id/extra", "analyses/id/days/extra", "analyses/id/detections/extra"]) {
    const path = `workspaces/workspace/${suffix}`;
    const response = await GET(new NextRequest(`http://localhost/api/v2/${path}`), { params: Promise.resolve({ path: path.split("/") }) });
    assert.equal(response.status, 404, path);
    assert.equal((await response.json()).code, "NOT_FOUND");
  }
});

test("workspace writes use the request host for same-origin checks", async () => {
  const request = (origin) => new NextRequest("http://0.0.0.0:3000/api/v2/workspaces", {
    method: "POST", headers: { host: "localhost:3000", origin, "content-type": "application/json" }, body: "{}",
  });
  const context = { params: Promise.resolve({ path: ["workspaces"] }) };
  assert.equal((await POST(request("http://localhost:3000"), context)).status, 400);
  assert.equal((await POST(request("http://attacker.example"), context)).status, 403);
});
