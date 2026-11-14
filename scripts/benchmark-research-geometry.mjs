import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { polygonFromVertices } from "../src/lib/research-geometry.ts";

const results = [];
for (const vertices of [3, 100, 500]) {
  const ring = Array.from({ length: vertices }, (_, index) => {
    const angle = 2 * Math.PI * index / vertices;
    return [114 + Math.cos(angle), -2.5 + Math.sin(angle)];
  });
  polygonFromVertices(ring);
  const samplesMs = [];
  for (let attempt = 0; attempt < 20; attempt++) {
    const start = performance.now();
    const result = polygonFromVertices(ring);
    samplesMs.push(performance.now() - start);
    assert.equal(result.coordinates[0].length, vertices + 1);
  }
  const sorted = [...samplesMs].sort((a, b) => a - b);
  results.push({ vertices, samplesMs, medianMs: (sorted[9] + sorted[10]) / 2, maxMs: sorted.at(-1) });
}
assert.throws(() => polygonFromVertices(Array.from({ length: 501 }, (_, i) => [i / 10, 0])), /vertex_count/);
const report = { node: process.version, platform: process.platform, arch: process.arch, synthetic: true, samplesPerSize: 20, note: "Local geometry validation only; not backend polygon querying, archive processing or an SLA", results };
mkdirSync(".cache/sprint3-acceptance", { recursive: true });
writeFileSync(".cache/sprint3-acceptance/geometry.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
