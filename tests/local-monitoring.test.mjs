import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { changeLocation, newLocation } from "../src/lib/local-monitoring.ts";
import { aggregateResearchCsv, rawResearchCsv, csvCell } from "../src/lib/research-export.ts";
import { calendarColors } from "../src/lib/calendar-colors.ts";

const examples = JSON.parse(readFileSync("docs/contracts/api-v2.examples.json", "utf8")).examples;
const result = examples.result;
const point = examples["detections-page"].observations[0];
const now = "2026-11-13T05:00:00.000Z";
const initial = () => newLocation(result, point, "Test location", "Local researcher");
const assign = { kind: "assign", assignee: "Inspector", recorder: "Coordinator" };
const report = { inspector: "Inspector", recorder: "Recorder", observedAt: "2026-11-12T03:00:00.000Z", outcome: "inconclusive", notes: "Original" };

test("location preserves original evidence and idempotent assignments reject conflicts", () => {
  const original = initial();
  const saved = changeLocation(original, 1, "assign-1", assign, now);
  assert.equal(original.assignments.length, 0);
  assert.deepEqual(saved.anchor, point);
  assert.deepEqual(saved.initialAnalysis, result);
  assert.deepEqual(changeLocation(saved, 1, "assign-1", assign, now), saved);
  assert.throws(() => changeLocation(saved, 1, "assign-1", { ...assign, assignee: "Other" }, now), /IDEMPOTENCY_CONFLICT/);
  assert.throws(() => changeLocation(saved, 1, "assign-2", assign, now), /REVISION_CONFLICT/);
});
test("inspection needs a report before completion; another inspection uses a new assignment", () => {
  let saved = changeLocation(initial(), 1, "assign-1", assign, now);
  const complete = { kind: "status", assignmentId: "assign-1", status: "completed", actor: "Coordinator" };
  assert.throws(() => changeLocation(saved, saved.revision, "finish", complete, now), /REPORT_REQUIRED/);
  assert.throws(() => changeLocation(saved, saved.revision, "future", { kind: "report", assignmentId: "assign-1", report: { ...report, observedAt: "2099-01-01T00:00:00Z" } }, now), /FUTURE_INSPECTION/);
  saved = changeLocation(saved, saved.revision, "report-1", { kind: "report", assignmentId: "assign-1", report }, now);
  assert.equal(saved.assignments[0].status, "assigned");
  saved = changeLocation(saved, saved.revision, "finish", complete, now);
  assert.throws(() => changeLocation(saved, saved.revision, "resume", { ...complete, status: "in_progress" }, now), /INVALID_TRANSITION/);
  saved = changeLocation(saved, saved.revision, "assign-2", assign, now);
  assert.equal(saved.assignments.length, 2);
  assert.equal(saved.assignments[0].reports.length, 1);
});
test("corrections retain original recorder, previous values, reason and correction actor", () => {
  let saved = changeLocation(initial(), 1, "assign-1", assign, now);
  saved = changeLocation(saved, saved.revision, "report-1", { kind: "report", assignmentId: "assign-1", report }, now);
  saved = changeLocation(saved, saved.revision, "correct-1", { kind: "correct", assignmentId: "assign-1", reportId: "report-1", report: { ...report, notes: "Corrected", recorder: "Editor" }, reason: "Fix transcription" }, now);
  const corrected = saved.assignments[0].reports[0];
  assert.equal(corrected.recorder, "Recorder");
  assert.equal(corrected.notes, "Corrected");
  assert.equal(corrected.revision, 2);
  assert.deepEqual(corrected.corrections[0].previous, report);
  assert.equal(corrected.corrections[0].correctedBy, "Editor");
});
test("CSV retains source observations, nullable estimates and provenance without synthetic points", () => {
  const raw = rawResearchCsv(result, [point]);
  assert(raw.includes(point.id));
  assert(raw.includes(result.area.geometryHash));
  assert.equal(raw.split("\r\n").length, 2);
  const unknown = structuredClone(result);
  unknown.months[0].metric.harmonizedCount = null;
  const aggregated = aggregateResearchCsv(unknown);
  assert(aggregated.includes('"harmonizedCount"'));
  assert(aggregated.includes(result.method.name));
  assert.equal(csvCell(null), "");
  assert.equal(csvCell(-3.2), '"-3.2"');
  assert.equal(csvCell(" =1+1"), '"\' =1+1"');
  assert.equal(csvCell('a,"b'), '"a,""b"');
  assert.throws(() => rawResearchCsv({ ...result, comparison: null }, [], "comparison"), /INVALID_REQUEST/);
});

test("empty raw exports retain provenance in a typed metadata row with no observation", () => {
  const exported = rawResearchCsv(result, []);
  assert.equal(exported.split("\r\n").length, 2);
  assert(exported.split("\r\n")[1].startsWith('"metadata",'));
  for (const value of [result.id, result.area.geometryHash, result.primary.period.start, result.method.name, result.baseline.policyVersion]) assert(exported.includes(value));
  assert(!exported.includes('"observation",'));
  assert(exported.endsWith(",,,,,,,"));
});

test("every interpolated count/anomaly color has at least 4.5:1 text contrast", () => {
  for (const layer of ["count", "anomaly"]) {
    for (let step = 0; step <= 1000; step++) {
      const { background, color } = calendarColors(layer, step / 1000);
      const linear = background.match(/\d+/g).map(Number).map(value => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
      const contrast = color === "#ffffff" ? 1.05 / (luminance + 0.05) : (luminance + 0.05) / 0.05;
      assert(contrast >= 4.5, `${layer} ${step}: ${contrast}`);
    }
  }
});
