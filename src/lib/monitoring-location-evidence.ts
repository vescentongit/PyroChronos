import type { LocationDatabase } from "./monitoring-locations.ts";
import {
	iterateResearchObservations,
	type PublishedAnalysis,
	type ResearchArtifactReader,
	type ResearchObservation,
} from "./research-observations.ts";
import { fail } from "./research-store.ts";

export {
	readPublishedAnalysis,
	type PublishedAnalysis,
	type ResearchArtifactReader,
} from "./research-observations.ts";

export async function findOriginalObservation(
	db: LocationDatabase,
	reader: ResearchArtifactReader,
	result: PublishedAnalysis,
	anchorId: string,
): Promise<ResearchObservation> {
	let anchor: ResearchObservation | undefined;
	for await (const observation of iterateResearchObservations(
		db,
		reader,
		result,
	)) {
		if (observation.id === anchorId) anchor = observation;
	}
	return anchor ?? fail("NOT_FOUND", 404);
}
