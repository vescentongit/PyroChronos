import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { foundationFixture } from "./research-foundation-fixtures.mjs";

export const sha256 = (bytes) =>
	`sha256:${createHash("sha256").update(bytes).digest("hex")}`;
export const artifact = (
	kind = "observations",
	content = Buffer.from('{"synthetic":true}\n'),
) => ({
	kind,
	periodRole: "primary",
	format: "json",
	content,
	bytes: content.byteLength,
	checksum: sha256(content),
});

export function publicationFixture() {
	const f = foundationFixture();
	const began = new Date(Date.now() - 3000).toISOString();
	f.job.createdAt = f.job.startedAt = began;
	f.attempt.claimedAt = f.attempt.heartbeatAt = began;
	f.attempt.status = "running";
	f.attempt.completedAt = null;
	f.attempt.leaseExpiresAt = new Date(Date.now() + 120000).toISOString();
	return {
		fixture: f,
		request: {
			claim: {
				jobId: f.job.id,
				workspaceId: f.job.workspaceId,
				attemptId: f.attempt.id,
				leaseToken: f.attempt.leaseToken,
			},
			producer: { result: f.result.payload, manifest: f.manifest },
			artifacts: [artifact()],
		},
	};
}

export async function insertRow(sql, table, row) {
	const keys = Object.keys(row);
	const cast = (key) => {
		if (key === "requestId" || key === "leaseToken") return "::uuid";
		if (key === "status")
			return table === "AnalysisJob"
				? '::"AnalysisJobStatus"'
				: '::"AnalysisAttemptStatus"';
		if (
			[
				"createdAt",
				"startedAt",
				"completedAt",
				"claimedAt",
				"heartbeatAt",
				"leaseExpiresAt",
			].includes(key)
		)
			return "::timestamptz";
		if (
			["input", "error", "content", "payload", "anchor", "createdBy"].includes(
				key,
			)
		)
			return "::jsonb";
		if (key === "areaRevision" || key === "attemptNo") return "::integer";
		if (key === "progressPercent") return "::double precision";
		return "";
	};
	await sql.query(
		`INSERT INTO "${table}" (${keys.map((key) => `"${key}"`).join(",")}) VALUES (${keys.map((key, i) => `$${i + 1}${cast(key)}`).join(",")})`,
		Object.values(row).map((value) =>
			value !== null && typeof value === "object"
				? JSON.stringify(value)
				: value,
		),
	);
}

export async function seedPublication(sql, f) {
	const { schemaVersion, ...job } = f.job;
	await insertRow(sql, "AnalysisJob", {
		...job,
		status: "queued",
		stage: null,
		progressPercent: null,
		startedAt: null,
	});
	await sql.query(
		'UPDATE "AnalysisJob" SET "status"=\'running\', "startedAt"=$1::timestamptz WHERE "id"=$2',
		[f.job.startedAt, f.job.id],
	);
	await insertRow(sql, "AnalysisJobAttempt", f.attempt);
}

export async function applyResearchMigrations(sql) {
	const root = new URL("../../prisma/migrations/", import.meta.url);
	const dirs = (await readdir(root, { withFileTypes: true }))
		.filter((d) => d.isDirectory())
		.map((d) => d.name)
		.sort();
	for (const dir of dirs)
		await sql.exec(
			await readFile(new URL(`${dir}/migration.sql`, root), "utf8"),
		);
}

export function pgliteDatabase(db) {
	return {
		async query(sql, params = []) {
			return (await db.query(sql, [...params])).rows;
		},
		async transaction(run) {
			return db.transaction((tx) =>
				run({
					async query(sql, params = []) {
						return (await tx.query(sql, [...params])).rows;
					},
				}),
			);
		},
	};
}

export function makeRawResult(request) {
	const result = request.producer.result;
	result.mode = "research";
	result.method.name = "raw-counts-per-source";
	result.method.validation = "unsupported";
	for (const entry of [
		result.primary,
		result.comparison,
		...result.months,
	].filter(Boolean)) {
		entry.metric.harmonizedCount = null;
		entry.metric.status = "method_unsupported";
	}
	for (const month of result.months)
		month.anomaly = {
			status: "method_unsupported",
			referenceYears: [],
			baselineStatistic: null,
			baselineValue: null,
			delta: null,
			scoreKind: null,
			score: null,
		};
}
