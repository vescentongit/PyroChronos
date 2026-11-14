// Kill barrier inside the real publisher transaction, on a dedicated test schema only.
import { PrismaClient } from "@prisma/client";
import { loadInspectionModule } from "./research-inspection-fixtures.mjs";
const url = new URL(process.env.DATABASE_URL);
if (
	!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
	url.pathname !== "/research_worker_test" ||
	!/^publication_test_[a-f0-9]{32}$/.test(url.searchParams.get("schema") || "")
)
	throw new Error("DEDICATED_TEST_DATABASE_REQUIRED");
const { publishResearchResult } = await loadInspectionModule(
	"research-publication",
);
const { prismaPublicationDatabase } = await loadInspectionModule(
	"research-publication-db",
);
const { FileResearchArtifactStorage } = await loadInspectionModule(
	"research-publication-storage",
);
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const request = JSON.parse(Buffer.concat(chunks).toString());
request.artifacts = request.artifacts.map((item) => ({
	...item,
	content: Buffer.from(item.content.data),
}));
const client = new PrismaClient({ datasourceUrl: url.href });
const database = prismaPublicationDatabase(client);
const blocked = {
	...database,
	transaction: (run) =>
		database.transaction((tx) =>
			run({
				...tx,
				query: async (statement, params) => {
					const result = await tx.query(statement, params);
					if (
						statement.trimStart().startsWith('INSERT INTO "AnalysisResult"')
					) {
						process.stdout.write("inside-publication\n");
						await new Promise(() => {});
					}
					return result;
				},
			}),
		),
};
try {
	await publishResearchResult(
		{
			database: blocked,
			storage: new FileResearchArtifactStorage(
				process.env.RESEARCH_ARTIFACT_ROOT,
			),
		},
		request,
	);
} finally {
	await client.$disconnect();
}
