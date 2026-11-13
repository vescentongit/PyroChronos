import { PrismaClient } from "@prisma/client";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
	researchProducerConfigSchema,
	producerConfigurationKey,
} from "../src/lib/research-producer-contracts.ts";
import {
	assertPublicationMetadataSafe,
	publicationSecrets,
} from "../src/lib/research-publication-values.ts";

if (existsSync(".env")) process.loadEnvFile(".env");
const python = process.env.RESEARCH_PYTHON || process.env.PYTHON || "python";
function describe() {
	return new Promise((resolve, reject) => {
		const child = spawn(python, ["pipeline/research_worker.py"], {
			stdio: ["pipe", "pipe", "ignore"],
			windowsHide: true,
		});
		const chunks = [];
		let size = 0;
		child.stdout.on("data", (chunk) => {
			size += chunk.length;
			if (size > 12 * 1024 * 1024) child.kill();
			else chunks.push(chunk);
		});
		child.on("error", () => reject(new Error("PRODUCER_UNAVAILABLE")));
		child.on("close", (code) => {
			if (code) reject(new Error("PRODUCER_UNAVAILABLE"));
			else {
				try {
					resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
				} catch {
					reject(new Error("INVALID_OUTPUT"));
				}
			}
		});
		child.stdin.on("error", () => child.kill());
		child.stdin.end(
			JSON.stringify({
				action: "describe",
				root: process.env.RESEARCH_DATA_DIR,
				modelsDir: process.env.RESEARCH_MODELS_DIR,
				mode: process.env.RESEARCH_PRODUCER_MODE || "research",
			}),
		);
	});
}
try {
	if (!process.env.RESEARCH_DATA_DIR) throw new Error("DATASET_REQUIRED");
	if (process.argv.includes("--register")) {
		const config = researchProducerConfigSchema.parse(await describe());
		assertPublicationMetadataSafe(config, publicationSecrets());
		const id = randomUUID(),
			client = new PrismaClient();
		try {
			await client.$executeRawUnsafe(
				'INSERT INTO "ResearchDataset" (id,config) VALUES ($1,$2::jsonb)',
				id,
				JSON.stringify(config),
			);
		} finally {
			await client.$disconnect();
		}
		console.log(
			JSON.stringify({
				status: "registered",
				datasetId: id,
				configurationKey: producerConfigurationKey(config),
			}),
		);
	} else {
		const child = spawn(
			python,
			[
				"pipeline/research_p1_worker.py",
				...(process.argv.includes("--once") ? ["--once"] : []),
			],
			{
				stdio: ["pipe", "inherit", "ignore"],
				windowsHide: true,
				env: { ...process.env, RESEARCH_NODE: process.execPath },
			},
		);
		let shutdownTimer;
		child.stdin.on("error", () => {});
		const stop = () => {
			if (!child.stdin.writableEnded) child.stdin.end("stop\n");
			shutdownTimer ??= setTimeout(() => child.kill("SIGTERM"), 10000).unref();
		};
		process.once("SIGINT", stop);
		process.once("SIGTERM", stop);
		const code = await new Promise((resolve) => {
			child.once("error", () => resolve(1));
			child.once("close", (value) => resolve(value ?? 1));
		});
		clearTimeout(shutdownTimer);
		process.removeListener("SIGINT", stop);
		process.removeListener("SIGTERM", stop);
		process.exitCode = code;
	}
} catch {
	console.error("RESEARCH_WORKER_UNAVAILABLE");
	process.exitCode = 1;
}
