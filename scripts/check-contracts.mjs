import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { snapshotSchema, parseSnapshot } from "../src/lib/snapshot.ts";
import { studyRegions } from "../src/lib/regions.ts";
import { hotspotsSchema, querySchema } from "../src/lib/hotspots.ts";
import {
  createReportSchema,
  correctReportSchema,
  reportResponseSchema,
  apiErrorSchema,
} from "../src/lib/api-contracts.ts";

const contracts = {
  hotspots: hotspotsSchema,
  "hotspots-query": querySchema,
  snapshot: snapshotSchema,
  "report-create": createReportSchema,
  "report-correction": correctReportSchema,
  report: reportResponseSchema,
  error: apiErrorSchema,
};
for (const [name, schema] of Object.entries(contracts)) {
  const file = new URL(
    `../docs/contracts/${name}.schema.json`,
    import.meta.url,
  );
  const generated = z.toJSONSchema(schema, { io: "input" });
  if (process.argv.includes("--write"))
    writeFileSync(file, JSON.stringify(generated, null, 2) + "\n");
  else
    assert.deepEqual(
      JSON.parse(readFileSync(file)),
      generated,
      `${name} JSON Schema drifted; regenerate with --write`,
    );
}
const examples = JSON.parse(
  readFileSync(
    new URL("../docs/contracts/api-v1.examples.json", import.meta.url),
  ),
);
for (const example of examples.snapshots)
  parseSnapshot(
    example,
    studyRegions.find((region) => region.id === example.regionId),
    "operational",
  );
createReportSchema.parse(examples.createReport);
correctReportSchema.parse(examples.correctReport);
reportResponseSchema.parse(examples.report);
apiErrorSchema.parse(examples.error);
assert.equal(
  examples.correctReport.expectedRevision + 1,
  examples.report.revision,
);
assert.equal(examples.report.corrections[0].revision, 1);
assert.equal(
  examples.report.corrections[0].requestId,
  examples.correctReport.requestId,
);
assert.equal(
  createReportSchema.safeParse({
    ...examples.createReport,
    recorder: { id: "forged" },
  }).success,
  false,
);
assert.equal(
  correctReportSchema.safeParse({
    ...examples.correctReport,
    expectedRevision: 0,
  }).success,
  false,
);
console.log(
  `Contract v1: 5 schemas, ${examples.snapshots.length} snapshots, report create/correction/history, error and negative cases passed.`,
);
