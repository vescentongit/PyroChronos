import test from "node:test";
import assert from "node:assert/strict";
import { polygonFromVertices, researchMapGeometry } from "../src/lib/research-geometry.ts";

const vertices = [[112, -4], [118, -4], [118, 3], [112, 3]];
const polygon = polygonFromVertices(vertices);

test("undo replaces the sketch and hides both old boundaries", () => {
  const next = researchMapGeometry(vertices.slice(0, -1), polygon, polygon, false);
  assert.equal(next.editing, true);
  assert.equal(next.outlines.features.length, 0);
  assert.deepEqual(next.edits.features.filter(f => f.geometry.type === "Point").map(f => f.geometry.coordinates), vertices.slice(0, -1));
  assert.deepEqual(next.edits.features.at(-1).geometry.coordinates, vertices.slice(0, -1));
});

test("undo to zero removes all points and lines; cancel restores applied boundary", () => {
  for (let count = 2; count >= 0; count--) {
    const next = researchMapGeometry(vertices.slice(0, count), polygon, polygon, true);
    assert.equal(next.outlines.features.length, 0);
    assert.equal(next.edits.features.filter(f => f.geometry.type === "Point").length, count);
    assert.equal(next.edits.features.filter(f => f.geometry.type === "LineString").length, count > 1 ? 1 : 0);
  }
  const cancelled = researchMapGeometry(vertices, polygon, null, false);
  assert.equal(cancelled.edits.features.length, 0);
  assert.equal(cancelled.outlines.features.length, 1);
});

test("starting an edit hides old result even before adding a point", () => {
  assert.equal(researchMapGeometry(vertices, polygon, polygon, true).outlines.features.length, 0);
  assert.equal(researchMapGeometry([], null, null, false).edits.features.length, 0);
});

test("date line sketch stays continuous after undo", () => {
  const next = researchMapGeometry([[179, 0], [-179, 0]], null, null, true);
  assert.deepEqual(next.edits.features.at(-1).geometry.coordinates, [[179, 0], [181, 0]]);
});
