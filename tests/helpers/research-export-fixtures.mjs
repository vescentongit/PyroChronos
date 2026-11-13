import {
	loadInspectionModule,
	assignments,
	reports,
} from "./research-inspection-fixtures.mjs";
import {
	locations,
	publishedFixture,
	Storage,
	sqlAdapter,
} from "./monitoring-location-fixtures.mjs";
export const exportsService = await loadInspectionModule("research-exports");
export const exportWorker = await loadInspectionModule(
	"research-export-worker",
);
export const exportQueue = await loadInspectionModule("research-export-queue");
export { loadInspectionModule, assignments, reports, Storage, sqlAdapter };

export async function exportFixture(database, storage, options = {}) {
	const fixture = await publishedFixture(database, storage, {
		...options,
		mutateResult(result) {
			const metric = (count) => ({
				rawCount: count,
				harmonizedCount: null,
				rawCountsBySource: Object.fromEntries(
					result.sources.map((s) => [
						s.id,
						s.id === "VIIRS_SNPP_SP" ? count : 0,
					]),
				),
				status: "method_unsupported",
			});
			result.primary.metric = metric(1);
			if (result.comparison) result.comparison.metric = metric(0);
			for (const month of result.months)
				month.metric = metric(month.month === "2026-08" ? 1 : 0);
			options.mutateResult?.(result);
		},
	});
	const location = options.skipLocation
		? null
		: await locations.createMonitoringLocation(
				{ database, artifacts: storage },
				fixture.workspace,
				fixture.user,
				fixture.body,
			);
	return { ...fixture, location, dependencies: { database, storage } };
}
