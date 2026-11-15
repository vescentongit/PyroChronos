import assert from "node:assert/strict";
import { test } from "node:test";
import { containsPoint, validateResearchGeometry } from "../src/lib/research-server-geometry.ts";

test("server validates holes and date-line polygons while preserving the submitted geometry", () => {
  const geometry = { type: "Polygon", coordinates: [
    [[170,-10],[-170,-10],[-170,10],[170,10],[170,-10]],
    [[175,-2],[-175,-2],[-175,2],[175,2],[175,-2]],
  ] };
  const result = validateResearchGeometry(geometry);
  assert.deepEqual(result.geometry, geometry);
  assert(result.areaKm2 > 0);
  assert.equal(containsPoint(geometry, [179, 0]), false);
  assert.equal(containsPoint(geometry, [-179, 5]), true);
  assert.equal(containsPoint(geometry, [0, 0]), false);
  assert.throws(() => validateResearchGeometry({ type: "Polygon", coordinates: [geometry.coordinates[0], [[0,0],[1,0],[1,1],[0,0]]] }));
});

test("geometry identity ignores ring direction and starting vertex", () => {
  const a = { type: "Polygon", coordinates: [[[0,0],[2,0],[2,1],[0,1],[0,0]]] };
  const b = { type: "Polygon", coordinates: [[[2,1],[2,0],[0,0],[0,1],[2,1]]] };
  assert.equal(validateResearchGeometry(a).geometryHash, validateResearchGeometry(b).geometryHash);
});
