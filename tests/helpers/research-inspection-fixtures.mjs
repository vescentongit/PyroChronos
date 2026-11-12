import { registerHooks } from "node:module";
import {
	locations,
	publishedFixture,
	Storage,
	sqlAdapter,
} from "./monitoring-location-fixtures.mjs";

export async function loadInspectionModule(name) {
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
	try {
		return await import(`../../src/lib/${name}.ts`);
	} finally {
		hook.deregister();
	}
}
export const assignments = await loadInspectionModule("inspection-assignments");
export const reports = await loadInspectionModule("research-reports");
export { Storage, sqlAdapter };
export async function inspectionFixture(db, storage) {
	const evidence = await publishedFixture(db, storage);
	const location = await locations.createMonitoringLocation(
		{ database: db, artifacts: storage },
		evidence.workspace,
		evidence.user,
		evidence.body,
	);
	for (const id of ["inspector-user", "recorder-user", "other-user"]) {
		await db.query('INSERT INTO "User" (id,name) VALUES ($1,$1)', [id]);
		await db.query(
			'INSERT INTO "Membership" ("workspaceId","userId",role) VALUES ($1,$2,\'member\')',
			[evidence.workspace, id],
		);
	}
	return {
		...evidence,
		location,
		owner: evidence.user,
		inspector: "inspector-user",
		recorder: "recorder-user",
		other: "other-user",
	};
}
