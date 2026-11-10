export type Vertex = [number, number];
export type AreaPolygon = { type: "Polygon"; coordinates: Vertex[][] };

export function unwrapVertices(vertices: Vertex[]): Vertex[] {
  const ring: Vertex[] = [];
  for (const [longitude, latitude] of vertices) {
    let x = longitude;
    const previous = ring.at(-1)?.[0] ?? x;
    while (x - previous > 180) x -= 360;
    while (x - previous < -180) x += 360;
    ring.push([x, latitude]);
  }
  return ring;
}

// Unwrap the date line before checking topology; do not silently clip global AOIs.
export function polygonFromVertices(vertices: Vertex[]): AreaPolygon {
  if (vertices.length < 3 || vertices.length > 500)
    throw new Error("vertex_count");
  if (
    vertices.some(
      ([x, y]) =>
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        Math.abs(x) > 180 ||
        Math.abs(y) > 90,
    )
  )
    throw new Error("coordinates");
  if (
    new Set(vertices.map((point) => point.join(","))).size !== vertices.length
  )
    throw new Error("duplicate_vertices");
  const ring = unwrapVertices(vertices);
  if (
    Math.max(...ring.map(([x]) => x)) - Math.min(...ring.map(([x]) => x)) >=
    180
  )
    throw new Error("hemisphere");
  const cross = (a: Vertex, b: Vertex, c: Vertex) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const onSegment = (a: Vertex, b: Vertex, c: Vertex) =>
    Math.abs(cross(a, b, c)) < 1e-10 &&
    c[0] >= Math.min(a[0], b[0]) &&
    c[0] <= Math.max(a[0], b[0]) &&
    c[1] >= Math.min(a[1], b[1]) &&
    c[1] <= Math.max(a[1], b[1]);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length];
    for (let j = i + 1; j < ring.length; j++) {
      if (j === i + 1 || (i === 0 && j === ring.length - 1)) continue;
      const c = ring[j],
        d = ring[(j + 1) % ring.length];
      if (
        (cross(a, b, c) * cross(a, b, d) < 0 &&
          cross(c, d, a) * cross(c, d, b) < 0) ||
        onSegment(a, b, c) ||
        onSegment(a, b, d) ||
        onSegment(c, d, a) ||
        onSegment(c, d, b)
      )
        throw new Error("self_intersection");
    }
  }
  const area = ring.reduce((sum, a, i) => {
    const b = ring[(i + 1) % ring.length];
    return sum + a[0] * b[1] - b[0] * a[1];
  }, 0);
  if (Math.abs(area) < 1e-10) throw new Error("zero_area");
  return {
    type: "Polygon",
    coordinates: [
      [...vertices.map((point): Vertex => [...point]), [...vertices[0]]],
    ],
  };
}

export function requestIdentity(
  previous: { key: string; id: string } | null,
  key: string,
) {
  return previous?.key === key ? previous : { key, id: crypto.randomUUID() };
}
