import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { applyResearchMigrations } from "./helpers/research-publication-fixtures.mjs";
import {
	locations,
	publishedFixture,
	sqlAdapter,
	Storage,
} from "./helpers/monitoring-location-fixtures.mjs";

let pg,
	root,
	database,
	storage,
	evidence,
	service,
	sequence = 0;
before(async () => {
	pg = await PGlite.create();
	root = await mkdtemp(path.join(tmpdir(), "monitoring-locations-"));
});
after(async () => {
	await pg?.close();
	if (root) await rm(root, { recursive: true, force: true });
});
beforeEach(async () => {
	await pg.exec(
		`CREATE SCHEMA locations_${++sequence}; SET search_path TO locations_${sequence}, public`,
	);
	await applyResearchMigrations(pg);
	database = sqlAdapter(pg);
	storage = new Storage(path.join(root, String(sequence)));
	evidence = await publishedFixture(database, storage);
	service = { database, artifacts: storage };
});
const create = (body = evidence.body, changes = {}) =>
	locations.createMonitoringLocation(
		{ ...service, ...changes },
		evidence.workspace,
		evidence.user,
		body,
	);
const rejects = (run, code) =>
	assert.rejects(run, (error) => error.code === code);
const count = async (table) =>
	Number((await database.query(`SELECT count(*) AS n FROM "${table}"`))[0].n);

test("create stores the exact original observation, AOI revision and server actor", async () => {
	const first = await create();
	assert.deepEqual(first.anchor, evidence.observation);
	assert.equal(first.initialAnalysisId, evidence.analysisId);
	assert.equal(first.areaId, evidence.fixture.job.input.area.id);
	assert.equal(first.areaRevision, evidence.fixture.job.input.area.revision);
	assert.deepEqual(first.createdBy, {
		id: evidence.user,
		displayName: "Synthetic researcher",
	});
	assert.equal(await count("MonitoringLocationAnalysis"), 1);
	assert.deepEqual(
		await locations.getMonitoringLocation(
			service,
			evidence.workspace,
			evidence.user,
			first.id,
		),
		first,
	);
	assert.equal("requestHash" in first, false);
});

test("identical retries and concurrent calls return one location; changed payload conflicts", async () => {
	const [first, second] = await Promise.all([create(), create()]);
	assert.deepEqual(first, second);
	assert.deepEqual(
		await create({
			...evidence.body,
			requestId: evidence.body.requestId.toUpperCase(),
		}),
		first,
	);
	assert.equal(await count("MonitoringLocation"), 1);
	await rejects(
		() => create({ ...evidence.body, name: "changed" }),
		"IDEMPOTENCY_CONFLICT",
	);
	await rejects(
		() => create({ ...evidence.body, anchorDetectionId: "other" }),
		"IDEMPOTENCY_CONFLICT",
	);
	assert.equal(await count("MonitoringLocationAnalysis"), 1);
});

test("strict input rejects coordinates, forged creator/workspace, missing anchors and cluster IDs", async () => {
	for (const extra of [
		{ coordinates: [0, 0] },
		{ createdBy: { id: "other" } },
		{ workspaceId: "other" },
		{ anchor: evidence.observation },
	]) {
		await rejects(
			() => create({ ...evidence.body, ...extra }),
			"INVALID_REQUEST",
		);
	}
	await rejects(
		() => create({ ...evidence.body, anchorDetectionId: "cluster:42" }),
		"INVALID_REQUEST",
	);
	await rejects(
		() => create({ ...evidence.body, anchorDetectionId: "missing" }),
		"NOT_FOUND",
	);
	await rejects(
		() => create({ ...evidence.body, analysisId: "missing" }),
		"NOT_FOUND",
	);
	assert.equal(await count("MonitoringLocation"), 0);
});

test("workspace outsiders and inactive members cannot create, list, read or link", async () => {
	const first = await create();
	for (const user of ["outsider", evidence.user]) {
		if (user === evidence.user)
			await database.query(
				'UPDATE "Membership" SET active=false WHERE "workspaceId"=$1 AND "userId"=$2',
				[evidence.workspace, user],
			);
		for (const run of [
			() =>
				locations.createMonitoringLocation(
					service,
					evidence.workspace,
					user,
					evidence.body,
				),
			() =>
				locations.listMonitoringLocations(service, evidence.workspace, user),
			() =>
				locations.getMonitoringLocation(
					service,
					evidence.workspace,
					user,
					first.id,
				),
			() =>
				locations.linkMonitoringLocationAnalysis(
					service,
					evidence.workspace,
					user,
					first.id,
					evidence.analysisId,
				),
		])
			await rejects(run, "FORBIDDEN");
	}
});

test("foreign workspace resource IDs return no data even to an active member", async () => {
	const first = await create();
	await database.query(
		"INSERT INTO \"Workspace\" (id,name,\"createdById\") VALUES ('other-workspace','Other',$1)",
		[evidence.user],
	);
	await database.query(
		'INSERT INTO "Membership" ("workspaceId","userId",role) VALUES (\'other-workspace\',$1,\'owner\')',
		[evidence.user],
	);
	await rejects(
		() =>
			locations.createMonitoringLocation(
				service,
				"other-workspace",
				evidence.user,
				evidence.body,
			),
		"NOT_FOUND",
	);
	await rejects(
		() =>
			locations.getMonitoringLocation(
				service,
				"other-workspace",
				evidence.user,
				first.id,
			),
		"NOT_FOUND",
	);
	await rejects(
		() =>
			locations.linkMonitoringLocationAnalysis(
				service,
				"other-workspace",
				evidence.user,
				first.id,
				evidence.analysisId,
			),
		"NOT_FOUND",
	);
	assert.deepEqual(
		await locations.listMonitoringLocations(
			service,
			"other-workspace",
			evidence.user,
		),
		{ items: [], nextCursor: null },
	);
});

test("stored snapshots and idempotent retries remain readable after artifacts disappear", async () => {
	const first = await create();
	const unavailable = {
		read: async () => {
			throw new Error("private-path-secret-sentinel");
		},
	};
	assert.deepEqual(
		await create(evidence.body, { artifacts: unavailable }),
		first,
	);
	assert.deepEqual(
		await locations.getMonitoringLocation(
			{ ...service, artifacts: unavailable },
			evidence.workspace,
			evidence.user,
			first.id,
		),
		first,
	);
	await rejects(
		() =>
			create(
				{ ...evidence.body, requestId: randomUUID() },
				{ artifacts: unavailable },
			),
		"DEPENDENCY_UNAVAILABLE",
	);
});

test("corrupt artifact bytes fail closed and roll back idempotency and location writes", async () => {
	const [metadata] = await database.query('SELECT * FROM "P1AnalysisArtifact"');
	await writeFile(
		path.join(storage.root, metadata.objectKey),
		"corrupted-sentinel",
	);
	await rejects(() => create(), "DEPENDENCY_UNAVAILABLE");
	assert.equal(await count("MonitoringLocation"), 0);
	assert.equal(await count("ResearchRequest"), 0);
});

for (const [name, mutatePage] of [
	[
		"different result",
		(p) => {
			p.analysisId = "foreign-analysis";
		},
	],
	[
		"different period role",
		(p) => {
			p.periodRole = "comparison";
		},
	],
	[
		"unlisted source",
		(p) => {
			p.observations[0].sourceId = "unknown";
		},
	],
	[
		"outside period",
		(p) => {
			p.observations[0].observedAt = "2000-01-01T00:00:00Z";
		},
	],
	[
		"outside AOI",
		(p) => {
			p.observations[0].coordinates = [0, 0];
		},
	],
])
	test(`publisher rejects an artifact with ${name} before it reaches locations`, async () => {
		await rejects(
			() => publishedFixture(database, storage, { mutatePage }),
			"INVALID_OUTPUT",
		);
		assert.equal(await count("MonitoringLocation"), 0);
		assert.equal(await count("AnalysisResult"), 1);
	});

test("pagination is deterministic across tied timestamps and validates workspace-bound cursors", async () => {
	const first = await create();
	for (let i = 0; i < 4; i++)
		await create({
			...evidence.body,
			requestId: randomUUID(),
			name: `Location ${i}`,
		});
	const all = await locations.listMonitoringLocations(
		service,
		evidence.workspace,
		evidence.user,
	);
	assert.equal(all.items.length, 5);
	assert.equal(all.nextCursor, null);
	const ids = [];
	let cursor;
	do {
		const page = await locations.listMonitoringLocations(
			service,
			evidence.workspace,
			evidence.user,
			{ limit: 2, cursor },
		);
		ids.push(...page.items.map((item) => item.id));
		cursor = page.nextCursor;
	} while (cursor);
	assert.equal(new Set(ids).size, 5);
	assert.ok(ids.includes(first.id));
	for (const query of [
		{ limit: 0 },
		{ limit: 101 },
		{ limit: 1.5 },
		{ cursor: "broken" },
	]) {
		await rejects(
			() =>
				locations.listMonitoringLocations(
					service,
					evidence.workspace,
					evidence.user,
					query,
				),
			"INVALID_REQUEST",
		);
	}
});

test("pagination defaults to 50, accepts 100 and preserves every tied timestamp across pages", async () => {
	const first = await create();
	await database.query(
		`INSERT INTO "MonitoringLocation"
		(id,"workspaceId","requestId","requestHash",name,"anchorDetectionId",anchor,"initialAnalysisId","areaId","areaRevision","createdById","createdBy","createdAt")
		SELECT 'location-' || n, "workspaceId",md5(n::text)::uuid,"requestHash",name,"anchorDetectionId",anchor,"initialAnalysisId","areaId","areaRevision","createdById","createdBy","createdAt"
		FROM "MonitoringLocation" CROSS JOIN generate_series(1,104) n WHERE id=$1`,
		[first.id],
	);
	const defaults = await locations.listMonitoringLocations(
		service,
		evidence.workspace,
		evidence.user,
	);
	assert.equal(defaults.items.length, 50);
	const maximum = await locations.listMonitoringLocations(
		service,
		evidence.workspace,
		evidence.user,
		{ limit: 100 },
	);
	assert.equal(maximum.items.length, 100);
	const rest = await locations.listMonitoringLocations(
		service,
		evidence.workspace,
		evidence.user,
		{ limit: 100, cursor: maximum.nextCursor },
	);
	assert.equal(rest.items.length, 5);
	assert.equal(rest.nextCursor, null);
	assert.equal(
		new Set([...maximum.items, ...rest.items].map((item) => item.id)).size,
		105,
	);
	const foreignCursor = Buffer.from(
		JSON.stringify({ scope: "locations:another-workspace", after: "anything" }),
	).toString("base64url");
	await rejects(
		() =>
			locations.listMonitoringLocations(
				service,
				evidence.workspace,
				evidence.user,
				{ cursor: foreignCursor },
			),
		"INVALID_REQUEST",
	);
});

test("later analysis links append idempotently without changing the initial evidence", async () => {
	const first = await create();
	const later = await publishedFixture(database, storage);
	await locations.linkMonitoringLocationAnalysis(
		service,
		evidence.workspace,
		evidence.user,
		first.id,
		later.analysisId,
	);
	await locations.linkMonitoringLocationAnalysis(
		service,
		evidence.workspace,
		evidence.user,
		first.id,
		later.analysisId,
	);
	assert.equal(await count("MonitoringLocationAnalysis"), 2);
	assert.deepEqual(
		await locations.getMonitoringLocation(
			service,
			evidence.workspace,
			evidence.user,
			first.id,
		),
		first,
	);
	await rejects(
		() =>
			locations.linkMonitoringLocationAnalysis(
				service,
				evidence.workspace,
				evidence.user,
				first.id,
				"missing",
			),
		"NOT_FOUND",
	);
	await assert.rejects(
		database.query(
			"UPDATE \"MonitoringLocation\" SET anchor='{}'::jsonb WHERE id=$1",
			[first.id],
		),
	);
	await assert.rejects(
		database.query(
			'DELETE FROM "MonitoringLocationAnalysis" WHERE "locationId"=$1',
			[first.id],
		),
	);
});

test("failure inserting the initial link rolls back the whole create transaction", async () => {
	await pg.exec(
		`CREATE FUNCTION reject_location_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private-database-sentinel'; END; $$; CREATE TRIGGER reject_link BEFORE INSERT ON "MonitoringLocationAnalysis" FOR EACH ROW EXECUTE FUNCTION reject_location_link()`,
	);
	await assert.rejects(create());
	assert.equal(await count("MonitoringLocation"), 0);
	assert.equal(await count("ResearchRequest"), 0);
});
