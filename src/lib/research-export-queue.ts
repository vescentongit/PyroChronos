import { randomUUID } from "node:crypto";
import type { LocationDatabase } from "./monitoring-locations.ts";
import {
	researchExportRecordSchema,
	researchExportAttemptSchema,
	type ResearchExportClaim,
} from "./research-export-contracts.ts";
import { fail, errorPayload } from "./research-store.ts";
import { inspectionInstantSchema } from "./research-inspection-contracts.ts";

export interface ExportLeasePolicy {
	leaseSeconds?: number;
	maxAttempts?: number;
}
export async function exportDatabaseTime(
	db: LocationDatabase,
): Promise<string> {
	return inspectionInstantSchema.parse(
		(await db.query("SELECT clock_timestamp()::timestamptz(3) AS now"))[0]?.now,
	);
}
const deadline = (now: string, seconds: number) =>
	new Date(Date.parse(now) + seconds * 1000).toISOString();
function leaseSeconds(policy: ExportLeasePolicy): number {
	const value = policy.leaseSeconds ?? 60;
	if (!Number.isFinite(value) || value < 0.05 || value > 3600)
		return fail("INVALID_REQUEST");
	return value;
}
export async function claimResearchExport(
	db: LocationDatabase,
	policy: ExportLeasePolicy = {},
): Promise<ResearchExportClaim | null> {
	const seconds = leaseSeconds(policy);
	return db.transaction(async (tx) => {
		const [selected] =
			await tx.query(`SELECT e.* FROM "ResearchExport" e WHERE e.status='queued' OR (e.status='running' AND EXISTS
			(SELECT 1 FROM "ResearchExportAttempt" a WHERE a."exportId"=e.id AND a.status='running' AND a."leaseExpiresAt"<=clock_timestamp())) ORDER BY e."createdAt",e.id FOR UPDATE OF e SKIP LOCKED LIMIT 1`);
		if (!selected) return null;
		let job = researchExportRecordSchema.parse(selected);
		const latest = (
			await tx.query(
				'SELECT * FROM "ResearchExportAttempt" WHERE "exportId"=$1 ORDER BY "attemptNo" DESC LIMIT 1',
				[job.id],
			)
		)[0];
		const previous = latest ? researchExportAttemptSchema.parse(latest) : null;
		const now = await exportDatabaseTime(tx);
		if (previous?.status === "running")
			await tx.query(
				'UPDATE "ResearchExportAttempt" SET status=\'expired\',"completedAt"=$1::timestamptz,"errorCode"=\'LEASE_EXPIRED\',retryable=true WHERE id=$2',
				[now, previous.id],
			);
		if ((previous?.attemptNo ?? 0) >= (policy.maxAttempts ?? 3)) {
			await tx.query(
				'UPDATE "ResearchExport" SET status=\'failed\',"completedAt"=$1::timestamptz,error=$2::jsonb WHERE id=$3',
				[now, JSON.stringify(errorPayload("DEPENDENCY_UNAVAILABLE")), job.id],
			);
			return null;
		}
		const [updated] = await tx.query(
			'UPDATE "ResearchExport" SET status=\'running\',"startedAt"=COALESCE("startedAt",$1::timestamptz) WHERE id=$2 RETURNING *',
			[now, job.id],
		);
		job = researchExportRecordSchema.parse(updated);
		const [attempt] = await tx.query(
			`INSERT INTO "ResearchExportAttempt" (id,"exportId","workspaceId","attemptNo","leaseToken","claimedAt","heartbeatAt","leaseExpiresAt")
			VALUES ($1,$2,$3,$4,$5::uuid,$6::timestamptz,$6::timestamptz,$7::timestamptz) RETURNING *`,
			[
				randomUUID(),
				job.id,
				job.workspaceId,
				(previous?.attemptNo ?? 0) + 1,
				randomUUID(),
				now,
				deadline(now, seconds),
			],
		);
		return { job, attempt: researchExportAttemptSchema.parse(attempt) };
	});
}
export async function lockResearchExportClaim(
	tx: LocationDatabase,
	claim: ResearchExportClaim,
): Promise<boolean> {
	const [job] = await tx.query(
		'SELECT id FROM "ResearchExport" WHERE id=$1 AND "workspaceId"=$2 AND status=\'running\' FOR UPDATE',
		[claim.job.id, claim.job.workspaceId],
	);
	if (!job) return false;
	const [attempt] = await tx.query(
		`SELECT id FROM "ResearchExportAttempt" WHERE id=$1 AND "exportId"=$2 AND "workspaceId"=$3 AND "leaseToken"=$4::uuid AND status='running'
		AND "leaseExpiresAt">clock_timestamp() AND "attemptNo"=(SELECT max("attemptNo") FROM "ResearchExportAttempt" WHERE "exportId"=$2)`,
		[
			claim.attempt.id,
			claim.job.id,
			claim.job.workspaceId,
			claim.attempt.leaseToken,
		],
	);
	return Boolean(attempt);
}
export async function heartbeatResearchExport(
	db: LocationDatabase,
	claim: ResearchExportClaim,
	policy: ExportLeasePolicy = {},
): Promise<boolean> {
	return db.transaction(async (tx) => {
		if (!(await lockResearchExportClaim(tx, claim))) return false;
		const now = await exportDatabaseTime(tx);
		await tx.query(
			'UPDATE "ResearchExportAttempt" SET "heartbeatAt"=$1::timestamptz,"leaseExpiresAt"=GREATEST("leaseExpiresAt",$2::timestamptz) WHERE id=$3',
			[now, deadline(now, leaseSeconds(policy)), claim.attempt.id],
		);
		return true;
	});
}
export async function failResearchExport(
	db: LocationDatabase,
	claim: ResearchExportClaim,
	code:
		| "DEPENDENCY_UNAVAILABLE"
		| "CAPACITY_LIMIT"
		| "INVALID_REQUEST"
		| "INTERNAL_ERROR",
	policy: ExportLeasePolicy = {},
): Promise<boolean> {
	return db.transaction(async (tx) => {
		if (!(await lockResearchExportClaim(tx, claim))) return false;
		const now = await exportDatabaseTime(tx);
		const retry =
			code === "DEPENDENCY_UNAVAILABLE" &&
			claim.attempt.attemptNo < (policy.maxAttempts ?? 3);
		await tx.query(
			'UPDATE "ResearchExportAttempt" SET status=\'failed\',"completedAt"=$1::timestamptz,"errorCode"=$2,retryable=$3 WHERE id=$4',
			[now, code, retry, claim.attempt.id],
		);
		await tx.query(
			'UPDATE "ResearchExport" SET status=$1::"P1ResearchExportStatus","completedAt"=$2::timestamptz,error=$3::jsonb WHERE id=$4',
			[
				retry ? "queued" : "failed",
				retry ? null : now,
				retry ? null : JSON.stringify(errorPayload(code)),
				claim.job.id,
			],
		);
		return true;
	});
}
