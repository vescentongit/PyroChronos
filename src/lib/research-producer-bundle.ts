import { producerBundleSchema } from "./research-store.ts";
import { PublicationFailure } from "./research-publication-values.ts";

export function validateP1ProducerBundle(raw: unknown) {
	try {
		const bundle = producerBundleSchema.parse(raw),
			result = bundle.result;
		const roles = result.comparison
			? (["primary", "comparison"] as const)
			: (["primary"] as const);
		if (
			[...bundle.days, ...bundle.detections].some(
				(page) => !roles.some((role) => role === page.periodRole),
			)
		)
			throw new PublicationFailure("INVALID_OUTPUT");
		const sourceIds = result.sources.map((source) => source.id).sort();
		for (const role of roles) {
			const summary = role === "primary" ? result.primary : result.comparison;
			if (!summary) throw new PublicationFailure("INVALID_OUTPUT");
			const observed = new Map<string, number>(),
				seen = new Set<string>();
			for (const page of bundle.detections.filter(
				(page) => page.periodRole === role,
			)) {
				if (page.analysisId !== result.id)
					throw new PublicationFailure("INVALID_OUTPUT");
				for (const observation of page.observations) {
					if (seen.has(observation.id)) continue;
					seen.add(observation.id);
					const key = `${observation.sourceId}:${new Date(observation.observedAt).toISOString().slice(0, 10)}`;
					observed.set(key, (observed.get(key) ?? 0) + 1);
				}
			}
			const dates = new Set<string>(),
				months = new Set<string>();
			const pages = bundle.days.filter((page) => page.periodRole === role);
			if (!pages.length || pages.length > 1200)
				throw new PublicationFailure("INVALID_OUTPUT");
			for (const page of pages) {
				if (
					page.analysisId !== result.id ||
					page.nextCursor !== null ||
					!page.days.length ||
					months.has(page.month)
				)
					throw new PublicationFailure("INVALID_OUTPUT");
				months.add(page.month);
				for (const day of page.days) {
					if (
						day.date < summary.period.start ||
						day.date > summary.period.end ||
						dates.has(day.date) ||
						Object.keys(day.metric.rawCountsBySource).sort().join("|") !==
							sourceIds.join("|")
					)
						throw new PublicationFailure("INVALID_OUTPUT");
					dates.add(day.date);
					for (const source of sourceIds) {
						const count = day.metric.rawCountsBySource[source],
							expected = observed.get(`${source}:${day.date}`) ?? 0;
						if (
							(count === null ? expected !== 0 : count !== expected) ||
							(summary.metric.rawCountsBySource[source] === null &&
								count !== null)
						)
							throw new PublicationFailure("INVALID_OUTPUT");
					}
					if (
						result.method.validation === "unsupported" &&
						(day.metric.harmonizedCount !== null ||
							day.anomaly.status === "assessed")
					)
						throw new PublicationFailure("INVALID_OUTPUT");
				}
			}
			const expectedDays =
				(Date.parse(summary.period.end) - Date.parse(summary.period.start)) /
					86400000 +
				1;
			if (dates.size !== expectedDays)
				throw new PublicationFailure("INVALID_OUTPUT");
			const values = pages.flatMap((page) =>
				page.days.map((day) => day.metric.harmonizedCount),
			);
			if (
				summary.metric.harmonizedCount !== null &&
				(values.some((value) => value === null) ||
					Math.abs(
						values.reduce<number>((sum, value) => sum + (value ?? 0), 0) -
							summary.metric.harmonizedCount,
					) >
						dates.size * 1e-6 + 1e-8)
			)
				throw new PublicationFailure("INVALID_OUTPUT");
			if (role === "primary")
				for (const month of result.months) {
					const page = pages.find((page) => page.month === month.month);
					if (!page) throw new PublicationFailure("INVALID_OUTPUT");
					if (
						month.metric.harmonizedCount !== null &&
						(page.days.some((day) => day.metric.harmonizedCount === null) ||
							Math.abs(
								page.days.reduce(
									(sum, day) => sum + (day.metric.harmonizedCount ?? 0),
									0,
								) - month.metric.harmonizedCount,
							) >
								page.days.length * 1e-6 + 1e-8)
					)
						throw new PublicationFailure("INVALID_OUTPUT");
				}
		}
		return bundle;
	} catch {
		throw new PublicationFailure("INVALID_OUTPUT");
	}
}
