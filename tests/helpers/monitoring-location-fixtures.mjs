import { randomUUID } from "node:crypto";
import { registerHooks } from "node:module";
import {
	artifact,
	makeRawResult,
	publicationFixture,
	seedPublication,
} from "./research-publication-fixtures.mjs";

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
let locations, storageModule, publication;
try {
	locations = await import("../../src/lib/monitoring-locations.ts");
	storageModule = await import("../../src/lib/research-publication-storage.ts");
	publication = await import("../../src/lib/research-publication.ts");
} finally {
	hook.deregister();
}
export { locations };
export const Storage = storageModule.FileResearchArtifactStorage;
export const sqlAdapter = (client) => ({
	query: async (statement, params = []) =>
		(await client.query(statement, [...params])).rows,
	transaction: (run) => client.transaction((tx) => run(sqlAdapter(tx))),
});

export async function publishedFixture(database, storage, options = {}) {
	const { request, fixture } = publicationFixture();
	const suffix = options.suffix ?? randomUUID();
	fixture.job.id = request.claim.jobId = `job-${suffix}`;
	fixture.attempt.id = request.claim.attemptId = `attempt-${suffix}`;
	fixture.attempt.jobId = fixture.job.id;
	fixture.attempt.leaseToken = request.claim.leaseToken = randomUUID();
	fixture.job.requestId = fixture.job.input.request.requestId = randomUUID();
	fixture.job.analysisKey = `sha256:${suffix.replaceAll("-", "").padEnd(64, "a").slice(0, 64)}`;
	request.producer.result.jobId = request.producer.manifest.jobId =
		fixture.job.id;
	makeRawResult(request);
	const result = request.producer.result;
	const metric = (count) => ({
		rawCount: count,
		harmonizedCount: null,
		rawCountsBySource: Object.fromEntries(
			result.sources.map((s) => [
				s.id,
				s.id === fixture.location.anchor.sourceId ? count : 0,
			]),
		),
		status: "method_unsupported",
	});
	result.primary.metric = metric(1);
	if (result.comparison) result.comparison.metric = metric(0);
	for (const month of result.months)
		month.metric = metric(
			month.month === fixture.location.anchor.observedAt.slice(0, 7) ? 1 : 0,
		);
	const workspace = fixture.job.workspaceId;
	const user = fixture.job.requestedById;
	await database.query(
		'INSERT INTO "User" (id,name) VALUES ($1,$2) ON CONFLICT DO NOTHING',
		[user, "Synthetic researcher"],
	);
	await database.query(
		'INSERT INTO "Workspace" (id,name,"createdById") VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
		[workspace, "Synthetic workspace", user],
	);
	await database.query(
		'INSERT INTO "Membership" ("workspaceId","userId",role) VALUES ($1,$2,\'owner\') ON CONFLICT DO NOTHING',
		[workspace, user],
	);
	if (options.withoutComparison) {
		fixture.job.input.request.comparisonPeriod = null;
		request.producer.result.comparison = null;
	}
	await seedPublication(database, fixture);
	const observation = structuredClone(fixture.location.anchor);
	const page = {
		schemaVersion: "research-2",
		analysisId: request.producer.result.id,
		periodRole: "primary",
		observations: [observation],
		nextCursor: null,
	};
	options.mutatePage?.(page);
	options.mutateResult?.(request.producer.result);
	request.artifacts = [
		artifact("observations", Buffer.from(JSON.stringify(page))),
		...(request.producer.result.comparison
			? [
					{
						...artifact(
							"observations",
							Buffer.from(
								JSON.stringify({
									schemaVersion: "research-2",
									analysisId: request.producer.result.id,
									periodRole: "comparison",
									observations: [],
									nextCursor: null,
								}),
							),
						),
						periodRole: "comparison",
					},
				]
			: []),
	];
	const { resultId: analysisId } = await publication.publishResearchResult(
		{ database, storage },
		request,
	);
	return {
		workspace,
		user,
		analysisId,
		observation,
		page,
		fixture,
		body: {
			requestId: randomUUID(),
			analysisId,
			anchorDetectionId: observation.id,
			name: "Synthetic monitoring site",
		},
	};
}
