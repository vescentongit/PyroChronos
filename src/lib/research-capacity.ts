// Engineering guardrails retained from B1 measurements, not deployment capacity/SLA.
export const capacityPolicy = Object.freeze({
	version: "research-capacity-1",
	anonymousConcurrency: 1,
	activeAnalysesPerWorkspace: 5,
	activeExportsPerWorkspace: 5,
	requestsPerMinute: 30,
	windowMs: 60_000,
	requestBytes: 100_000,
	localBundleBytes: 100_000_000,
	hostedBundleBytes: 4_000_000,
	observationsPerBundle: 100_000,
	exportObjectBytes: 64 * 1024 * 1024,
	exportInputBytes: 256 * 1024 * 1024,
	observationArtifacts: 128,
	uniqueExportObservations: 1_000_000,
});

export function backpressureHeaders(code: string): Record<string, string> {
	// Minimum retry spacing, never an estimate of job completion.
	return code === "RATE_LIMITED"
		? { "Retry-After": "60" }
		: code === "CAPACITY_LIMIT"
			? { "Retry-After": "2" }
			: {};
}

type Admission =
	| { release: () => void; code?: never }
	| { code: "CAPACITY_LIMIT" | "RATE_LIMITED"; release?: never };

export function createAnonymousAdmission(clock = Date.now) {
	let active = 0;
	let admitted: number[] = [];
	return {
		acquire(): Admission {
			const now = clock();
			admitted = admitted.filter(
				(time) => time > now - capacityPolicy.windowMs,
			);
			if (active >= capacityPolicy.anonymousConcurrency)
				return { code: "CAPACITY_LIMIT" };
			if (admitted.length >= capacityPolicy.requestsPerMinute)
				return { code: "RATE_LIMITED" };
			admitted.push(now);
			active++;
			let released = false;
			return {
				release() {
					if (!released) {
						active--;
						released = true;
					}
				},
			};
		},
	};
}
