import { randomUUID } from "node:crypto";
import type { LocationDatabase } from "./monitoring-locations.ts";
import {
	createResearchAnalysisSchema,
	researchAreaSchema,
	researchJobSchema,
} from "./research-contracts.ts";
import {
	analysisJobInputSchema,
	analysisJobRecordSchema,
} from "./research-foundation-contracts.ts";
import {
	researchProducerConfigSchema,
	producerConfigurationKey,
	scopedProducerVersions,
} from "./research-producer-contracts.ts";
import {
	canonicalJson,
	publicationChecksum,
	assertPublicationMetadataSafe,
	publicationSecrets,
} from "./research-publication-values.ts";
import {
	errorPayload,
	fail,
	idempotent,
	member,
	workspaceLock,
} from "./research-store.ts";
import { inspectionInstantSchema } from "./research-inspection-contracts.ts";

export function p1JobWire(raw: Record<string, unknown>, requestId?: string) {
	const record = analysisJobRecordSchema.parse({
		...raw,
		schemaVersion: "research-2",
		createdAt: inspectionInstantSchema.parse(raw.createdAt),
		startedAt:
			raw.startedAt == null
				? null
				: inspectionInstantSchema.parse(raw.startedAt),
		completedAt:
			raw.completedAt == null
				? null
				: inspectionInstantSchema.parse(raw.completedAt),
	});
	const { requestedById: _actor, input: _input, ...wire } = record;
	return researchJobSchema.parse({
		...wire,
		requestId: requestId ?? wire.requestId,
		error:
			record.status === "failed"
				? errorPayload(record.error?.code ?? "INTERNAL_ERROR")
				: null,
	});
}

export async function submitP1Analysis(
	db: LocationDatabase,
	workspaceId: string,
	userId: string,
	body: unknown,
) {
	const parsed = createResearchAnalysisSchema.safeParse(body);
	if (!parsed.success) return fail("INVALID_REQUEST");
	const input = {
		...parsed.data,
		requestId: parsed.data.requestId.toLowerCase(),
	};
	return db.transaction(async (tx) => {
		await workspaceLock(tx, workspaceId);
		await member(tx, workspaceId, userId);
		const receipt = await idempotent(
			tx,
			`analysis:${workspaceId}:${userId}`,
			input.requestId,
			input,
			async () => {
				const [dataset] = await tx.query(
					'SELECT * FROM "ResearchDataset" ORDER BY "createdAt" DESC,id DESC LIMIT 1',
				);
				const config = researchProducerConfigSchema.safeParse(dataset?.config);
				if (!config.success) return fail("DEPENDENCY_UNAVAILABLE", 503);
				assertPublicationMetadataSafe(config.data, publicationSecrets());
				const today = new Date().toISOString().slice(0, 10);
				if (
					[input.period, input.comparisonPeriod].some(
						(period) => period && period.end > today,
					) ||
					input.baseline.windowYears > 30 ||
					input.qualityPolicyVersion !== config.data.qualityPolicyVersion
				)
					return fail("INVALID_REQUEST");
				const [areaRow] = await tx.query(
					'SELECT * FROM "AnalysisArea" WHERE id=$1 AND "workspaceId"=$2',
					[input.areaId, workspaceId],
				);
				if (!areaRow) return fail("NOT_FOUND", 404);
				const area = researchAreaSchema.parse({
					...areaRow,
					schemaVersion: "research-2",
					createdAt: inspectionInstantSchema.parse(areaRow.createdAt),
				});
				if (area.revision !== input.areaRevision)
					return fail("REVISION_CONFLICT", 409);
				if (input.monitoringLocationId) {
					const [location] = await tx.query(
						'SELECT id FROM "MonitoringLocation" WHERE id=$1 AND "workspaceId"=$2',
						[input.monitoringLocationId, workspaceId],
					);
					if (!location) return fail("NOT_FOUND", 404);
				}
				const {
					requestId: _requestId,
					monitoringLocationId: _location,
					...settings
				} = input;
				const versions = scopedProducerVersions(
					config.data,
					input.period,
					input.comparisonPeriod,
				);
				const key = publicationChecksum(
					canonicalJson({
						workspaceId,
						area,
						settings,
						producer: producerConfigurationKey(config.data),
						versions,
					}),
				);
				let [job] = await tx.query(
					'SELECT * FROM "P1AnalysisJob" WHERE "workspaceId"=$1 AND "analysisKey"=$2 AND status<>\'failed\' ORDER BY "createdAt",id LIMIT 1',
					[workspaceId, key],
				);
				if (!job) {
					const [capacity] = await tx.query(
						"SELECT count(*)::int AS count FROM \"P1AnalysisJob\" WHERE \"workspaceId\"=$1 AND status IN ('queued','running')",
						[workspaceId],
					);
					if (Number(capacity.count) >= 5) return fail("CAPACITY_LIMIT", 503);
					const frozen = analysisJobInputSchema.parse({
						area,
						request: input,
						versions,
						producer: config.data,
						baselinePolicy: {
							version: config.data.baselinePolicyVersion,
							minimumValidYears: Math.min(
								config.data.model === null
									? input.baseline.windowYears
									: config.data.minimumValidYears,
								input.baseline.windowYears,
							),
						},
					});
					[job] = await tx.query(
						'INSERT INTO "P1AnalysisJob" (id,"workspaceId","requestedById","requestId","analysisKey","areaId","areaRevision",input) VALUES ($1,$2,$3,$4::uuid,$5,$6,$7,$8::jsonb) RETURNING *',
						[
							randomUUID(),
							workspaceId,
							userId,
							input.requestId,
							key,
							area.id,
							area.revision,
							canonicalJson(frozen),
						],
					);
				}
				if (input.monitoringLocationId)
					await tx.query(
						'INSERT INTO "P1AnalysisLocationRequest" ("jobId","workspaceId","locationId") VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
						[job.id, workspaceId, input.monitoringLocationId],
					);
				if (input.monitoringLocationId && job.status === "succeeded")
					await tx.query(
						'INSERT INTO "MonitoringLocationAnalysis" ("locationId","workspaceId","analysisId") VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
						[input.monitoringLocationId, workspaceId, job.resultId],
					);
				return {
					value: p1JobWire(job, input.requestId),
					status: job.status === "succeeded" ? 200 : 202,
				};
			},
		);
		return {
			value: researchJobSchema.parse(receipt.value),
			status: receipt.status,
		};
	});
}
