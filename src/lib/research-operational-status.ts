import { qualityLimitations } from "./research-deployment.ts";
type Database = {
	query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
};
const sources = [
	"MODIS_SP",
	"VIIRS_SNPP_SP",
	"MODIS_NRT",
	"VIIRS_SNPP_NRT",
	"VIIRS_NOAA20_NRT",
	"VIIRS_NOAA21_NRT",
];
const states = [
	"PENDING",
	"FETCHED",
	"VALID",
	"EMPTY",
	"REJECTED",
	"FAILED",
	"queued",
	"running",
	"succeeded",
	"failed",
	"ready",
];
export async function operationalStatus(db: Database) {
	const ingest = await db.query(
		'SELECT "sourceId",status,count(*)::int AS count FROM "RawBatch" GROUP BY "sourceId",status',
	);
	const jobs = await db.query(
		'SELECT status,count(*)::int AS count FROM "P1AnalysisJob" GROUP BY status',
	);
	const exports = await db.query(
		'SELECT status,count(*)::int AS count FROM "ResearchExport" GROUP BY status',
	);
	const [dataset] = await db.query(
		'SELECT config FROM "ResearchDataset" ORDER BY "createdAt" DESC,id DESC LIMIT 1',
	);
	const config = dataset?.config as Record<string, unknown> | undefined;
	const groups = (rows: Record<string, unknown>[]) =>
		rows.map((row) => ({
			status: states.includes(String(row.status)) ? row.status : "UNKNOWN",
			count:
				Number.isSafeInteger(Number(row.count)) && Number(row.count) >= 0
					? Number(row.count)
					: null,
		}));
	return {
		schemaVersion: "operational-status-1",
		scope: "operator-global-not-workspace-api",
		ingest: ingest.map((row, i) => ({
			...groups(ingest)[i],
			source: sources.includes(String(row.sourceId)) ? row.sourceId : "UNKNOWN",
		})),
		jobs: groups(jobs),
		exports: groups(exports),
		dataset: config
			? {
					fingerprint:
						typeof config.fingerprint === "string" &&
						/^sha256:[a-f0-9]{64}$/.test(config.fingerprint)
							? config.fingerprint
							: null,
					sources: Array.isArray(config.sources)
						? config.sources.filter((source) =>
								sources.includes(String(source)),
							)
						: [],
					mode: ["demo", "replay", "research"].includes(String(config.mode))
						? config.mode
						: "unknown",
				}
			: null,
		qualityLimitations,
	};
}
