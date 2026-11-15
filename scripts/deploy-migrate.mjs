import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { validateRuntime } from "../src/lib/research-deployment.ts";
// Explicit operator command only. Never imported from runtime or HTTP handlers.
if (
	!validateRuntime(process.env, "migration").ok ||
	process.env.RESEARCH_DEPLOY_MIGRATIONS !== "true"
) {
	console.error("MIGRATION_CONFIG_INVALID");
	process.exitCode = 1;
} else {
	const run = spawnSync(
		process.execPath,
		[resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"],
		{ env: process.env, stdio: "pipe", windowsHide: true },
	);
	console.log(run.status === 0 ? "MIGRATION_SUCCEEDED" : "MIGRATION_FAILED");
	process.exitCode = run.status === 0 ? 0 : 1;
}
