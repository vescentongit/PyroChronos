import assert from "node:assert/strict";
const base = process.env.TEST_URL || "http://localhost:3000";
const page = await fetch(base);
assert.equal(page.status, 200);
assert.match(await page.text(), /PyroChronos/);
const simulation = await fetch(`${base}/simulation`);
assert.equal(
  simulation.status,
  200,
  "Simulation route must serve the dashboard",
);
assert.match(await simulation.text(), /Dashboard/);
const reports = await fetch(`${base}/api/reports`);
assert.equal(reports.status, 401, "Unauthenticated reports must be private");
const write = await fetch(`${base}/api/reports`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({}),
});
assert.equal(write.status, 401, "Unauthenticated writes must be rejected");
const invalidRegion = await fetch(`${base}/api/firms?region=unknown`);
assert.equal(invalidRegion.status, 400);
const session = await fetch(`${base}/api/session`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ token: "invalid" }),
});
assert.ok(
  [401, 503].includes(session.status),
  "Invalid session must not authenticate",
);
console.log(
  "6 smoke checks passed: home, simulation, report privacy, write authorization, region validation, session rejection.",
);
