import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { snapshotSchema, parseSnapshot } from "../src/lib/snapshot.ts";
import { studyRegions } from "../src/lib/regions.ts";
import { hotspotsSchema, querySchema } from "../src/lib/hotspots.ts";
import { researchContracts } from "../src/lib/research-contracts.ts";
import { researchExportManifestSchema } from "../src/lib/research-export-contracts.ts";
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
  `Contract v1: ${Object.keys(contracts).length} schemas, ${examples.snapshots.length} snapshots, report create/correction/history, error and negative cases passed.`,
);

const researchExamples = JSON.parse(
  readFileSync(
    new URL("../docs/contracts/api-v2.examples.json", import.meta.url),
  ),
);
assert(researchExamples.notice.startsWith("SYNTHETIC"));
if (process.argv.includes("--write"))
  mkdirSync(new URL("../docs/contracts/v2/", import.meta.url), {
    recursive: true,
  });
for (const [name, schema] of Object.entries(researchContracts)) {
  const file = new URL(
    `../docs/contracts/v2/${name}.schema.json`,
    import.meta.url,
  );
  const generated = z.toJSONSchema(schema, { io: "input" });
  if (process.argv.includes("--write"))
    writeFileSync(file, JSON.stringify(generated, null, 2) + "\n");
  else
    assert.deepEqual(
      JSON.parse(readFileSync(file)),
      generated,
      `Research v2 ${name} schema drifted`,
    );
  assert(
    Object.hasOwn(researchExamples.examples, name),
    `Missing v2 ${name} example`,
  );
  schema.parse(researchExamples.examples[name]);
}
console.log(
  `Research v2: ${Object.keys(researchContracts).length} target schemas and synthetic examples passed; no v2 endpoint is claimed implemented.`,
);

const exportManifestFile = new URL("../docs/contracts/v2/export-manifest.schema.json", import.meta.url);
const exportManifestJson = z.toJSONSchema(researchExportManifestSchema, { io: "input" });
if (process.argv.includes("--write")) writeFileSync(exportManifestFile, JSON.stringify(exportManifestJson, null, 2) + "\n");
else assert.deepEqual(JSON.parse(readFileSync(exportManifestFile)), exportManifestJson, "Export manifest schema drifted");
const exportExamples = JSON.parse(readFileSync(new URL("../docs/contracts/research-export-manifest.examples.json", import.meta.url)));
assert(exportExamples.notice.startsWith("SYNTHETIC"));
researchExportManifestSchema.parse(exportExamples.manifest);
console.log("Protected research-export-manifest-1 schema and synthetic example passed.");
