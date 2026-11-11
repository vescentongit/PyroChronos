import { PrismaClient } from "@prisma/client";
import { spawn } from "node:child_process";
import { claimRun, failRun, hash, heartbeat, publishRun } from "../src/lib/research-store.ts";

const client = new PrismaClient();
function sql(client) {
  return {
    query: (statement, params = []) => client.$queryRawUnsafe(statement, ...params),
    transaction: fn => client.$transaction(tx => fn(sql(tx)), { timeout: 120000 }),
  };
}
const db = sql(client);
const root = process.env.RESEARCH_DATA_DIR;
if (!root) throw new Error("RESEARCH_DATA_DIR is required");
function python(request) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.RESEARCH_PYTHON || "python", ["pipeline/research_worker.py"], { stdio: ["pipe", "pipe", "pipe"] });
    let output = "", size = 0;
    child.stdout.on("data", chunk => { size += chunk.length; if (size > 100_000_000) child.kill(); else output += chunk; });
    child.on("error", reject);
    child.on("close", code => { if (code) reject(new Error("PRODUCER_FAILED")); else { try { resolve(JSON.parse(output)); } catch { reject(new Error("INVALID_PRODUCER")); } } });
    child.stdin.end(JSON.stringify(request));
  });
}
try {
  if (process.argv.includes("--register")) {
    const fingerprint = await python({ action: "fingerprint", root });
    const config = { fingerprint, sources: ["MODIS_SP", "VIIRS_SNPP_SP"], qualityPolicyVersion: "quality-policy-1", producerVersion: "research-raw-1" };
    const id = hash(config);
    await db.query('INSERT INTO "ResearchDataset" (id,config) VALUES ($1,$2::jsonb) ON CONFLICT (id) DO NOTHING RETURNING id', [id, JSON.stringify(config)]);
    console.log(`Registered dataset ${id}`);
  } else {
    do {
      const run = await claimRun(db);
      if (!run) {
        if (process.argv.includes("--once")) break;
        await new Promise(resolve => setTimeout(resolve, 3000));
        continue;
      }
      let lost = false;
      const timer = setInterval(() => heartbeat(db, run.id, run.leaseToken).then(ok => { if (!ok) lost = true; }).catch(() => { lost = true; }), 30000);
      try {
        const bundle = await python({ root, run });
        if (!lost) await publishRun(db, run, bundle);
      } catch {
        if (!lost) await failRun(db, run);
      } finally { clearInterval(timer); }
      if (process.argv.includes("--once")) break;
    } while (true);
  }
} finally { await client.$disconnect(); }
