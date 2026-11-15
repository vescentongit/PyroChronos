import { PrismaClient } from "@prisma/client";
import { existsSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { runResearchExportOnce } from "../src/lib/research-export-worker.ts";
import { privateResearchExportStorage } from "../src/lib/research-export-storage.ts";

if (existsSync(".env")) process.loadEnvFile(".env");
const stop = new AbortController();
process.once("SIGINT", () => stop.abort());
process.once("SIGTERM", () => stop.abort());
const client = new PrismaClient();
const sql = (connection) => ({
	query: (statement, params = []) =>
		connection.$queryRawUnsafe(statement, ...params),
	transaction: (run) =>
		connection.$transaction((tx) => run(sql(tx)), {
			maxWait: 5000,
			timeout: 15000,
		}),
});
try {
	if (!process.env.RESEARCH_ARTIFACT_ROOT)
		throw new Error("EXPORT_STORAGE_REQUIRED");
	const dependencies = {
		database: sql(client),
		storage: privateResearchExportStorage(process.env.RESEARCH_ARTIFACT_ROOT),
		signal: stop.signal,
	};
	while (!stop.signal.aborted) {
		try {
			const receipt = await runResearchExportOnce(dependencies);
			console.log(JSON.stringify({ status: receipt.status }));
		} catch {
			console.error("EXPORT_QUEUE_UNAVAILABLE");
			if (process.argv.includes("--once")) process.exitCode = 1;
		}
		if (process.argv.includes("--once")) break;
		await setTimeout(3000, undefined, { signal: stop.signal }).catch(() => {});
	}
} catch {
	console.error("EXPORT_WORKER_UNAVAILABLE");
	process.exitCode = 1;
} finally {
	await client.$disconnect();
}
