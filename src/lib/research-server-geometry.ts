import { createHash } from "node:crypto";
import { polygonFromVertices, unwrapVertices, type AreaPolygon, type Vertex } from "./research-geometry.ts";

const cross = (a: Vertex, b: Vertex, c: Vertex) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const on = (p: Vertex, a: Vertex, b: Vertex) => Math.abs(cross(a, b, p)) < 1e-10 &&
  p[0] >= Math.min(a[0], b[0]) && p[0] <= Math.max(a[0], b[0]) &&
  p[1] >= Math.min(a[1], b[1]) && p[1] <= Math.max(a[1], b[1]);
const intersects = (a: Vertex, b: Vertex, c: Vertex, d: Vertex) =>
  (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) ||
  on(c, a, b) || on(d, a, b) || on(a, c, d) || on(b, c, d);
function inside(p: Vertex, ring: Vertex[], boundary = true) {
  let hit = false;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if (on(p, a, b)) return boundary;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}
function prepared(geometry: AreaPolygon) {
  const rings = geometry.coordinates.map(ring => unwrapVertices(ring.slice(0, -1)));
  return rings.map((ring, i) => {
    const shift = i ? Math.round((rings[0][0][0] - ring[0][0]) / 360) * 360 : 0;
    return ring.map(([x, y]): Vertex => [x + shift, y]);
  });
}
export function containsPoint(geometry: AreaPolygon, point: Vertex) {
  const rings = prepared(geometry);
  const p: Vertex = [point[0] + Math.round((rings[0][0][0] - point[0]) / 360) * 360, point[1]];
  return inside(p, rings[0]) && !rings.slice(1).some(ring => inside(p, ring));
}
export function validateResearchGeometry(geometry: AreaPolygon) {
  if (geometry.coordinates.reduce((sum, ring) => sum + ring.length - 1, 0) > 500) throw new Error("vertices");
  for (const ring of geometry.coordinates) polygonFromVertices(ring.slice(0, -1));
  const rings = prepared(geometry);
  for (let i = 1; i < rings.length; i++) {
    if (!rings[i].every(point => inside(point, rings[0], false))) throw new Error("hole");
    for (let j = 0; j < i; j++) {
      const a = rings[i], b = rings[j];
      if (a.some((p, k) => b.some((q, l) => intersects(p, a[(k + 1) % a.length], q, b[(l + 1) % b.length])))) throw new Error("intersection");
      if (j && (inside(a[0], b) || inside(b[0], a))) throw new Error("nested_holes");
    }
  }
  const rad = Math.PI / 180;
  const areas = rings.map(ring => Math.abs(ring.reduce((sum, [x, y], i) => {
    const [nx, ny] = ring[(i + 1) % ring.length];
    return sum + (nx - x) * rad * (2 + Math.sin(y * rad) + Math.sin(ny * rad));
  }, 0)) * 6371.0088 ** 2 / 2);
  const areaKm2 = areas[0] - areas.slice(1).reduce((a, b) => a + b, 0);
  if (!Number.isFinite(areaKm2) || areaKm2 <= 0) throw new Error("area");
  // Canonicalize winding/start/hole order for identity; retain the submitted geometry.
  const canonicalRing = (ring: Vertex[]) => {
    const variants = [ring, [...ring].reverse()].map(points => {
      let start = 0;
      for (let i = 1; i < points.length; i++) if (points[i][0] < points[start][0] || (points[i][0] === points[start][0] && points[i][1] < points[start][1])) start = i;
      return JSON.stringify([...points.slice(start), ...points.slice(0, start)]);
    });
    return variants.sort()[0];
  };
  const canonical = geometry.coordinates.map(ring => canonicalRing(ring.slice(0, -1).map(([x, y]) => [x === 180 ? -180 : x, y])));
  const geometryHash = "sha256:" + createHash("sha256").update(JSON.stringify([canonical[0], ...canonical.slice(1).sort()])).digest("hex");
  return { geometry, geometryHash, areaKm2 };
}
