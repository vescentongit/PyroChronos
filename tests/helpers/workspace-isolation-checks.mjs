import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
	loadInspectionModule,
	assignments,
	reports,
} from "./research-inspection-fixtures.mjs";
export async function checkWorkspaceIsolation(db, f, storage) {
	const reads = await loadInspectionModule("research-analyses"),
		api = await loadInspectionModule("research-exports"),
		worker = await loadInspectionModule("research-export-worker"),
		locations = await loadInspectionModule("monitoring-locations"),
		store = await loadInspectionModule("research-store");
	const deps = { database: db, storage };
	const old = await reads.readResearchAnalysis(
		db,
		f.workspace,
		f.user,
		f.analysisId,
	);
	const created = await api.createResearchExport(deps, f.workspace, f.user, {
		requestId: randomUUID(),
		analysisId: f.analysisId,
		periodRole: "primary",
		kind: "raw-hotspots-csv",
	});
	assert.equal((await worker.runResearchExportOnce(deps)).status, "ready");
	const foreign = `foreign-${randomUUID()}`;
	await db.query(
		'INSERT INTO "Workspace" (id,name,"createdById") VALUES ($1,$1,$2)',
		[foreign, f.user],
	);
	await db.query(
		'INSERT INTO "Membership" ("workspaceId","userId",role) VALUES ($1,$2,\'owner\')',
		[foreign, f.user],
	);
	const actions = (workspace) => [
		() => reads.readResearchAnalysis(db, workspace, f.user, f.analysisId),
		() => reads.readResearchJob(db, workspace, f.user, old.jobId),
		() =>
			reads.readResearchDays(
				db,
				storage,
				workspace,
				f.user,
				f.analysisId,
				"primary",
				old.primary.period.start.slice(0, 7),
			),
		() =>
			reads.readResearchDetections(
				db,
				storage,
				workspace,
				f.user,
				f.analysisId,
				"primary",
				null,
			),
		() =>
			reads.readResearchTile(
				db,
				storage,
				workspace,
				f.user,
				f.analysisId,
				"primary",
				0,
				0,
				0,
			),
		() =>
			locations.getMonitoringLocation(
				{ database: db },
				workspace,
				f.user,
				f.location.id,
			),
		() =>
			assignments.listInspectionAssignments(
				db,
				workspace,
				f.user,
				f.location.id,
			),
		() => reports.listResearchReports(db, workspace, f.user, f.location.id),
		() => api.readResearchExport(deps, workspace, f.user, created.value.id),
		() =>
			api.getResearchExportManifest(deps, workspace, f.user, created.value.id),
		() =>
			api.getResearchExportDownload(deps, workspace, f.user, created.value.id),
	];
	for (const action of actions(foreign))
		await assert.rejects(action, (error) => error.code === "NOT_FOUND");
	await assert.rejects(
		() =>
			reads.readResearchDetections(
				db,
				storage,
				f.workspace,
				f.user,
				f.analysisId,
				"primary",
				store.cursorWrite(`detections:${foreign}:${f.analysisId}:primary`, 0),
			),
		(error) => error.code === "INVALID_REQUEST",
	);
	const a = await assignments.createInspectionAssignment(
		db,
		f.workspace,
		f.user,
		f.location.id,
		{ requestId: randomUUID(), assigneeUserId: f.user },
	);
	const recorder = `recorder-${randomUUID()}`;
	await db.query(
		"INSERT INTO \"User\" (id,name) VALUES ($1,'Synthetic recorder')",
		[recorder],
	);
	await db.query(
		'INSERT INTO "Membership" ("workspaceId","userId",role) VALUES ($1,$2,\'member\')',
		[f.workspace, recorder],
	);
	const r = await reports.createResearchReport(
		db,
		f.workspace,
		recorder,
		a.id,
		{
			requestId: randomUUID(),
			inspectorUserId: f.user,
			observedAt: `${old.primary.period.start}T00:00:00Z`,
			outcome: "inconclusive",
			notes: "Synthetic audit",
		},
	);
	const reportInput = {
		requestId: randomUUID(),
		inspectorUserId: f.user,
		observedAt: `${old.primary.period.start}T00:00:00Z`,
		outcome: "inconclusive",
		notes: "Foreign denied",
	};
	for (const action of [
		() =>
			assignments.createInspectionAssignment(
				db,
				foreign,
				f.user,
				f.location.id,
				{ requestId: randomUUID(), assigneeUserId: f.user },
			),
		() => reports.createResearchReport(db, foreign, f.user, a.id, reportInput),
		() =>
			reports.correctResearchReport(db, foreign, f.user, r.id, {
				...reportInput,
				expectedRevision: 1,
				reason: "Foreign denied",
			}),
		() =>
			api.createResearchExport(deps, foreign, f.user, {
				requestId: randomUUID(),
				analysisId: f.analysisId,
				periodRole: "primary",
				kind: "raw-hotspots-csv",
			}),
	])
		await assert.rejects(action, (error) => error.code === "NOT_FOUND");
	await db.query(
		'UPDATE "Membership" SET role=\'member\' WHERE "workspaceId"=$1 AND "userId"=$2',
		[f.workspace, f.user],
	);
	await assert.rejects(
		() =>
			reports.correctResearchReport(db, f.workspace, f.user, r.id, {
				requestId: randomUUID(),
				expectedRevision: 1,
				reason: "Synthetic",
				inspectorUserId: f.user,
				observedAt: `${old.primary.period.start}T00:00:00Z`,
				outcome: "inconclusive",
				notes: "Denied",
			}),
		(error) => error.code === "FORBIDDEN",
	);
	assert.equal(
		(await reads.readResearchAnalysis(db, f.workspace, f.user, f.analysisId))
			.id,
		f.analysisId,
	);
	const download = await api.getResearchExportDownload(
		deps,
		f.workspace,
		f.user,
		created.value.id,
	);
	await db.query(
		'UPDATE "Membership" SET active=false WHERE "workspaceId"=$1 AND "userId"=$2',
		[f.workspace, f.user],
	);
	for (const action of actions(f.workspace))
		await assert.rejects(action, (error) => error.code === "FORBIDDEN");
	await assert.rejects(
		download.content[Symbol.asyncIterator]().next(),
		(error) => error.code === "FORBIDDEN",
	);
}
