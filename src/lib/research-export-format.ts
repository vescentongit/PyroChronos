import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { publicationChecksum } from "./research-publication-values.ts";
import { fail } from "./research-store.ts";
import type {
	PublishedAnalysis,
	ResearchObservation,
} from "./research-observations.ts";
import type { ResearchExportRecord } from "./research-export-contracts.ts";

export async function researchExportFormatterVersion(): Promise<string> {
	const files = await Promise.all(
		["research_export.py", "research_export_worker.py"].map((file) =>
			readFile(resolve("pipeline", file)),
		),
	);
	return publicationChecksum(Buffer.concat(files));
}
export interface ExportFormatInput {
	job: ResearchExportRecord;
	result: PublishedAnalysis;
	observations: AsyncIterable<ResearchObservation>;
	signal: AbortSignal;
}
export type ExportFormatter = (
	input: ExportFormatInput,
) => AsyncIterable<Uint8Array>;
export async function* formatResearchExport(
	input: ExportFormatInput,
): AsyncGenerator<Uint8Array> {
	const child = spawn(
		process.env.RESEARCH_PYTHON || process.env.PYTHON || "python",
		[resolve("pipeline/research_export_worker.py")],
		{
			stdio: ["pipe", "pipe", "ignore"],
			signal: input.signal,
			windowsHide: true,
		},
	);
	const exited = new Promise<boolean>((resolveExit) => {
		child.once("error", () => resolveExit(false));
		child.once("close", (code) => resolveExit(code === 0));
	});
	const feed = (async () => {
		try {
			async function send(value: unknown) {
				if (!child.stdin.write(`${JSON.stringify(value)}\n`))
					await once(child.stdin, "drain");
			}
			await send({
				kind:
					input.job.kind === "raw_hotspots_csv"
						? "raw-hotspots-csv"
						: "harmonized-aggregates-csv",
				periodRole: input.job.periodRole,
				result: input.result,
			});
			if (input.job.kind === "raw_hotspots_csv")
				for await (const observation of input.observations) {
					input.signal.throwIfAborted();
					await send(observation);
				}
			child.stdin.end();
			return true;
		} catch {
			child.kill();
			return false;
		}
	})();
	child.stdin.on("error", () => {
		child.kill();
	});
	try {
		for await (const chunk of child.stdout) {
			input.signal.throwIfAborted();
			yield Uint8Array.from(chunk);
		}
		if (!(await feed) || !(await exited))
			return fail("DEPENDENCY_UNAVAILABLE", 503);
	} finally {
		if (child.exitCode === null) child.kill();
		await exited;
	}
}
