import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import {
  polygonFromVertices,
  requestIdentity,
  unwrapVertices,
} from "../src/lib/research-geometry.ts";

// Resolve the browser module's imports without changing the application's TS config.
const source = readFileSync(
  new URL("../src/lib/research-client.ts", import.meta.url),
  "utf8",
)
  .replace(
    '"./research-contracts"',
    JSON.stringify(
      new URL("../src/lib/research-contracts.ts", import.meta.url).href,
    ),
  )
  .replace(
    '"zod"',
    JSON.stringify(
      new URL("../node_modules/zod/index.js", import.meta.url).href,
    ),
  );
const js = stripTypeScriptTypes(source);
const client = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString("base64")}`
);
const fixtures = JSON.parse(
  readFileSync(
    new URL("../docs/contracts/api-v2.examples.json", import.meta.url),
    "utf8",
  ),
).examples;
const fixture = (name) => structuredClone(fixtures[name]);
const signal = () => new AbortController().signal;

test("free concave polygons close without mutating the draft; date-line polygons are supported", () => {
  const points = [
    [0, 0],
    [3, 0],
    [1, 1],
    [3, 3],
    [0, 3],
  ];
  const polygon = polygonFromVertices(points);
  assert.equal(polygon.coordinates[0].length, 6);
  assert.deepEqual(polygon.coordinates[0][0], polygon.coordinates[0].at(-1));
  assert.equal(points.length, 5);
  assert.doesNotThrow(() =>
    polygonFromVertices([
      [179, 0],
      [-179, 0],
      [-179, 2],
      [179, 2],
    ]),
  );
  assert.deepEqual(
    unwrapVertices([
      [179, 0],
      [-179, 0],
      [-179, 2],
    ]),
    [
      [179, 0],
      [181, 0],
      [181, 2],
    ],
  );
});
test("invalid, self-intersecting, touching, duplicate and collinear geometry cannot be submitted", () => {
  for (const points of [
    [],
    [
      [0, 0],
      [1, 1],
      [2, 2],
    ],
    [
      [0, 0],
      [3, 3],
      [0, 3],
      [3, 0],
    ],
    [
      [0, 0],
      [1, 1],
      [0, 0],
    ],
    [
      [181, 0],
      [0, 1],
      [1, 0],
    ],
    [
      [0, 0],
      [2, 0],
      [2, 2],
      [1, 0],
      [0, 2],
    ],
  ])
    assert.throws(() => polygonFromVertices(points));
});
test("retry preserves request identity; a changed payload gets a new identity", () => {
  const first = requestIdentity(null, "polygon-a-period-a");
  assert.equal(requestIdentity(first, first.key), first);
  assert.notEqual(requestIdentity(first, "polygon-b-period-a").id, first.id);
});
test("unavailable HTML API and authentication failures remain honest errors", async (t) => {
  const mock = t.mock.method(
    globalThis,
    "fetch",
    async () => new Response("not found", { status: 404 }),
  );
  await assert.rejects(client.listResearchWorkspaces(signal()), {
    code: "DEPENDENCY_UNAVAILABLE",
  });
  mock.mock.mockImplementation(
    async () => new Response("login", { status: 401 }),
  );
  await assert.rejects(client.listResearchWorkspaces(signal()), {
    code: "UNAUTHENTICATED",
  });
});
test("create area validates geometry and workspace returned by the server", async (t) => {
  const area = fixture("area");
  const request = fixture("area-create");
  const mock = t.mock.method(globalThis, "fetch", async () =>
    Response.json(area),
  );
  await client.createResearchArea(area.workspaceId, request, signal());
  area.workspaceId = "another-workspace";
  mock.mock.mockImplementation(async () => Response.json(area));
  await assert.rejects(
    client.createResearchArea("workspace-demo", request, signal()),
    { code: "INVALID_RESPONSE" },
  );
});
test("job and result must match the exact submitted area, dates, policy and workspace", async (t) => {
  const job = fixture("job");
  const request = fixture("analysis-create");
  const result = fixture("result");
  const mock = t.mock.method(globalThis, "fetch", async () =>
    Response.json(result),
  );
  const parsed = await client.watchResearch(
    job.workspaceId,
    job,
    request,
    signal(),
    () => {},
  );
  assert.equal(parsed.id, result.id);
  result.area.id = "different-area";
  mock.mock.mockImplementation(async () => Response.json(result));
  await assert.rejects(
    client.watchResearch(job.workspaceId, job, request, signal(), () => {}),
    { code: "INVALID_RESPONSE" },
  );
  assert.throws(
    () =>
      client.assertJobContext(
        { ...job, requestId: crypto.randomUUID() },
        job.workspaceId,
        request,
      ),
    { code: "INVALID_RESPONSE" },
  );
});
test("polling cancellation stops before fetching the next job", async (t) => {
  const controller = new AbortController();
  const fetchMock = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("must not fetch");
  });
  const job = {
    ...fixture("job"),
    status: "queued",
    resultId: null,
    completedAt: null,
    startedAt: null,
  };
  const pending = client.watchResearch(
    job.workspaceId,
    job,
    fixture("analysis-create"),
    controller.signal,
    () => controller.abort(),
  );
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(fetchMock.mock.callCount(), 0);
});
test("rate-limit response preserves server retry delay", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(null, { status: 429, headers: { "Retry-After": "60" } }),
  );
  await assert.rejects(
    client.listResearchWorkspaces(signal()),
    (error) => error.code === "RATE_LIMITED" && error.retryAfter === 60,
  );
});
