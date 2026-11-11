import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
	type AnalysisArtifact,
	type AnalysisJobAttempt,
	type AnalysisJobRecord,
	type AnalysisManifest,
	type AnalysisPublication,
	type AnalysisResultRecord,
	analysisArtifactSchema,
	analysisJobAttemptSchema,
	analysisJobRecordSchema,
	analysisManifestSchema,
	analysisResultRecordSchema,
} from "./research-foundation-contracts";
import {
	canonicalJson,
	PublicationFailure,
	publicationChecksum,
} from "./research-publication-values";

export type PublicationSqlValue = string | number | boolean | Date | null;
export interface PublicationSql {
	query(
		sql: string,
		params?: readonly PublicationSqlValue[],
	): Promise<unknown[]>;
}
export interface PublicationDatabase extends PublicationSql {
	transaction<T>(run: (tx: PublicationSql) => Promise<T>): Promise<T>;
}
export interface PublicationClaim {
	jobId: string;
	workspaceId: string;
	attemptId: string;
	leaseToken: string;
}
export interface PublicationContext {
	job: AnalysisJobRecord;
	attempt: AnalysisJobAttempt;
	now: string;
}
export interface StoredPublication {
	result: AnalysisResultRecord;
	manifest: AnalysisManifest;
	artifacts: AnalysisArtifact[];
}

export function prismaPublicationDatabase(
	client: PrismaClient,
): PublicationDatabase {
	return {
		query: (sql, params = []) =>
			client.$queryRawUnsafe<unknown[]>(sql, ...params),
		transaction: (run) =>
			client.$transaction(
				(tx) =>
					run({
						query: (sql, params = []) =>
							tx.$queryRawUnsafe<unknown[]>(sql, ...params),
					}),
				{ maxWait: 5000, timeout: 15000 },
			),
	};
}

const record = z.record(z.string(), z.unknown());
const contextRow = z.object({
	job: record,
	attempt: record,
	now: z.coerce.date(),
});

export async function readPublicationContext(
	sql: PublicationSql,
	claim: PublicationClaim,
	lock = false,
): Promise<PublicationContext> {
	if (lock)
		await sql.query(
			'SELECT "id" FROM "AnalysisJob" WHERE "id"=$1 AND "workspaceId"=$2 FOR UPDATE',
			[claim.jobId, claim.workspaceId],
		);
	const [raw] = await sql.query(
		`SELECT to_jsonb(j) AS job, to_jsonb(a) AS attempt,
    date_trunc('milliseconds', clock_timestamp()) AS now FROM "AnalysisJob" j
    JOIN LATERAL (SELECT * FROM "AnalysisJobAttempt" WHERE "jobId"=j."id"
      ORDER BY "attemptNo" DESC LIMIT 1) a ON true
    WHERE j."id"=$1 AND j."workspaceId"=$2 AND a."id"=$3 AND a."leaseToken"=$4::uuid`,
		[claim.jobId, claim.workspaceId, claim.attemptId, claim.leaseToken],
	);
	if (!raw) throw new PublicationFailure("LEASE_LOST");
	const row = contextRow.parse(raw);
	return {
		job: analysisJobRecordSchema.parse({
			schemaVersion: "research-2",
			...row.job,
		}),
		attempt: analysisJobAttemptSchema.parse(row.attempt),
		now: row.now.toISOString(),
	};
}

export async function readStoredPublication(
	sql: PublicationSql,
	jobId: string,
): Promise<StoredPublication> {
	const [raw] = await sql.query(
		`SELECT to_jsonb(r) AS result, m."content" AS manifest FROM "AnalysisResult" r
    JOIN "AnalysisManifest" m ON m."id"=r."manifestId" WHERE r."jobId"=$1`,
		[jobId],
	);
	const row = z
		.object({
			result: analysisResultRecordSchema,
			manifest: analysisManifestSchema,
		})
		.parse(raw);
	const artifacts = await sql.query(
		'SELECT * FROM "AnalysisArtifact" WHERE "resultId"=$1 ORDER BY "id"',
		[row.result.id],
	);
	return {
		...row,
		artifacts: artifacts.map((value) => {
			const data = record.parse(value);
			return analysisArtifactSchema.parse({
				...data,
				bytes: typeof data.bytes === "bigint" ? Number(data.bytes) : data.bytes,
			});
		}),
	};
}

export async function insertPublication(
	sql: PublicationSql,
	data: AnalysisPublication,
): Promise<void> {
	const { job, attempt, result, manifest, artifacts } = data;
	await sql.query(
		`INSERT INTO "AnalysisManifest" ("id","jobId","workspaceId","dataVersion","checksum","content")
    VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
		[
			manifest.id,
			job.id,
			job.workspaceId,
			manifest.dataVersion,
			publicationChecksum(canonicalJson(manifest)),
			canonicalJson(manifest),
		],
	);
	await sql.query(
		`INSERT INTO "AnalysisResult" ("id","jobId","workspaceId","manifestId","dataVersion","generatedAt","publishedAt","payload")
    VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8::jsonb)`,
		[
			result.id,
			job.id,
			job.workspaceId,
			manifest.id,
			result.dataVersion,
			result.generatedAt,
			result.publishedAt,
			canonicalJson(result.payload),
		],
	);
	for (const artifact of artifacts)
		await sql.query(
			`INSERT INTO "AnalysisArtifact"
    ("id","resultId","workspaceId","kind","periodRole","objectKey","checksum","bytes","format")
    VALUES ($1,$2,$3,$4::"AnalysisArtifactKind",$5,$6,$7,$8::bigint,$9)`,
			[
				artifact.id,
				result.id,
				job.workspaceId,
				artifact.kind,
				artifact.periodRole,
				artifact.objectKey,
				artifact.checksum,
				artifact.bytes,
				artifact.format,
			],
		);
	const completed = await sql.query(
		`UPDATE "AnalysisJobAttempt" SET "status"='succeeded', "completedAt"=$1::timestamptz
    WHERE "id"=$2 AND "jobId"=$3 AND "leaseToken"=$4::uuid AND "status"='running'
      AND "leaseExpiresAt">clock_timestamp() RETURNING "id"`,
		[attempt.completedAt, attempt.id, job.id, attempt.leaseToken],
	);
	if (!completed.length) throw new PublicationFailure("LEASE_LOST");
	const published = await sql.query(
		`UPDATE "AnalysisJob" SET "status"='succeeded', "stage"='publish',
    "progressPercent"=100, "resultId"=$1, "completedAt"=$2::timestamptz WHERE "id"=$3 AND "status"='running'
    AND EXISTS (SELECT 1 FROM "AnalysisJobAttempt" WHERE "id"=$4 AND "leaseExpiresAt">clock_timestamp()) RETURNING "id"`,
		[result.id, result.publishedAt, job.id, attempt.id],
	);
	if (!published.length) throw new PublicationFailure("LEASE_LOST");
}
