import { registerHooks } from "node:module";
import { PrismaClient } from "@prisma/client";

const hook = registerHooks({
	resolve(specifier, context, next) {
		return next(
			context.parentURL?.includes("/src/lib/") &&
				specifier.startsWith("./") &&
				!specifier.endsWith(".ts")
				? `${specifier}.ts`
				: specifier,
			context,
		);
	},
});
const { publishResearchResult } = await import(
	"../src/lib/research-publication.ts"
);
const { prismaPublicationDatabase } = await import(
	"../src/lib/research-publication-db.ts"
);
const { publicationResultId } = await import(
	"../src/lib/research-publication-producer.ts"
);
const { canonicalJson, publicationChecksum } = await import(
	"../src/lib/research-publication-values.ts"
);
const { FileResearchArtifactStorage } = await import(
	"../src/lib/research-publication-storage.ts"
);
const { validateP1ProducerBundle } = await import(
	"../src/lib/research-producer-bundle.ts"
);
hook.deregister();
const client = new PrismaClient();
try {
	const chunks = [];
	let size = 0;
	for await (const chunk of process.stdin) {
		size += chunk.length;
		if (size > 100 * 1024 * 1024) throw new Error("CAPACITY_LIMIT");
		chunks.push(chunk);
	}
	const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
	const bundle = validateP1ProducerBundle(input.bundle);
	const claim = input.claim;
	const resultId = publicationResultId({
		job: { id: claim.jobId, workspaceId: claim.workspaceId },
		attempt: { id: claim.attemptId },
	});
	const artifacts = [];
	for (const role of bundle.result.comparison
		? ["primary", "comparison"]
		: ["primary"]) {
		for (const [kind, pages] of [
			["observations", bundle.detections],
			["daily", bundle.days],
		]) {
			const selected = pages.filter((page) => page.periodRole === role);
			if (
				!selected.length ||
				selected.some((page) => page.analysisId !== bundle.result.id)
			)
				throw new Error("INVALID_OUTPUT");
			const content = Buffer.from(
				canonicalJson(
					kind === "daily"
						? selected.map((page) => ({ ...page, analysisId: resultId }))
						: selected,
				),
			);
			artifacts.push({
				kind,
				periodRole: role,
				format: "json",
				content,
				bytes: content.byteLength,
				checksum: publicationChecksum(content),
			});
		}
	}
	if (!process.env.RESEARCH_ARTIFACT_ROOT) throw new Error("STORAGE_REQUIRED");
	const receipt = await publishResearchResult(
		{
			database: prismaPublicationDatabase(client),
			storage: new FileResearchArtifactStorage(
				process.env.RESEARCH_ARTIFACT_ROOT,
			),
		},
		{
			claim,
			producer: { result: bundle.result, manifest: bundle.manifest },
			artifacts,
		},
	);
	console.log(
		JSON.stringify({ status: "succeeded", resultId: receipt.resultId }),
	);
} catch {
	console.log('{"status":"failed","code":"PUBLICATION_FAILED"}');
	process.exitCode = 1;
} finally {
	await client.$disconnect();
}
