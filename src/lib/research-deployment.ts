import { isAbsolute, relative, resolve } from "node:path";
export type RuntimeEnv = Record<string, string | undefined>;
export function validateRuntime(env: RuntimeEnv, role = "app") {
	const errors: string[] = [];
	const need = (name: string) => {
		if (!env[name]?.trim()) errors.push(name);
	};
	const url = (name: string, protocols: string[]) => {
		try {
			if (!protocols.includes(new URL(env[name] || "").protocol))
				errors.push(name);
		} catch {
			errors.push(name);
		}
	};
	if (
		![
			"app",
			"pipeline",
			"worker",
			"export-worker",
			"ingest",
			"migration",
		].includes(role)
	)
		errors.push("ROLE");
	for (const name of Object.keys(env))
		if (
			name.startsWith("NEXT_PUBLIC_") &&
			/(SECRET|TOKEN|PASSWORD|API_KEY|MAP_KEY|DATABASE_URL|PRIVATE_KEY|CONNECTION_STRING|DSN)/i.test(
				name,
			) &&
			env[name]
		)
			errors.push("PUBLIC_SECRET");
	if (
		role === "migration" ||
		["worker", "export-worker", "ingest"].includes(role) ||
		(role === "app" && env.RESEARCH_V2_EXPERIMENTAL === "true")
	) {
		need("DATABASE_URL");
		url("DATABASE_URL", ["postgres:", "postgresql:"]);
	}
	if (role === "app") {
		if (
			!env.PIPELINE_URL &&
			!env.RESEARCH_DATA_DIR &&
			!env.FIRMS_MAP_KEY?.trim()
		)
			errors.push("DATASET_BINDING");
		if (env.VERCEL && !env.PIPELINE_URL) errors.push("PIPELINE_URL");
		if (env.PIPELINE_URL) {
			url("PIPELINE_URL", ["https:", "http:"]);
			try {
				const u = new URL(env.PIPELINE_URL);
				if (u.username || u.password || u.search || u.hash)
					errors.push("PIPELINE_URL");
			} catch {}
		}
		if (env.RESEARCH_V2_EXPERIMENTAL === "true") {
			for (const name of [
				"AUTH_SECRET",
				"AUTH_GOOGLE_ID",
				"AUTH_GOOGLE_SECRET",
				"RESEARCH_ARTIFACT_ROOT",
			])
				need(name);
			if ((env.AUTH_SECRET?.length ?? 0) < 32) errors.push("AUTH_SECRET");
		}
	}
	if (["worker", "export-worker"].includes(role))
		need("RESEARCH_ARTIFACT_ROOT");
	if (role === "worker") need("RESEARCH_DATA_DIR");
	if (role === "ingest") {
		need("FIRMS_RAW_DIR");
		need("FIRMS_MAP_KEY");
	}
	if (role === "pipeline") {
		if (env.RESEARCH_DATA_DIR || env.FIRMS_MAP_KEY?.trim()) {
			// Same local/on-demand precedence as the Python analyze action.
		} else if (env.FIRMS_BLOB_BASE_URL) {
			url("FIRMS_BLOB_BASE_URL", ["https:"]);
			need("BLOB_READ_WRITE_TOKEN");
		} else need("RESEARCH_DATA_DIR");
	}
	if (env.RESEARCH_ARTIFACT_ROOT) {
		const root = env.RESEARCH_ARTIFACT_ROOT;
		if (
			!isAbsolute(root) ||
			["public", ".next/static"].some((dir) => {
				const p = relative(resolve(dir), resolve(root));
				return p === "" || (!p.startsWith("..") && !isAbsolute(p));
			})
		)
			errors.push("RESEARCH_ARTIFACT_ROOT");
	}
	return {
		ok: errors.length === 0,
		role: [
			"app",
			"pipeline",
			"worker",
			"export-worker",
			"ingest",
			"migration",
		].includes(role)
			? role
			: "unknown",
		errors: [...new Set(errors)],
	};
}
// Drop unknown fields instead of serializing untrusted exceptions or environment.
export function safeOperationalEvent(event: string, _detail: unknown = {}) {
	return {
		event: [
			"ready",
			"not_ready",
			"config_invalid",
			"auth_error",
			"auth_warning",
			"migration_failed",
			"migration_succeeded",
		].includes(event)
			? event
			: "operation_failed",
	};
}
export async function readiness(
	env: RuntimeEnv,
	probe: () => Promise<unknown>,
) {
	if (!validateRuntime(env).ok) return { status: "not_ready" as const };
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			probe(),
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error("UNAVAILABLE")), 5000);
			}),
		]);
		return { status: "ready" as const };
	} catch {
		return { status: "not_ready" as const };
	} finally {
		clearTimeout(timer);
	}
}
export const qualityLimitations = Object.freeze({
	N1: "NRT/standard revision not measured; sensitivity factors are assumptions, not corrections.",
	N2: "Transfer validation is domain-specific; unsupported domains including Kalteng/Papua retain null estimates.",
	N3: "QA coverage no-go: valid-pixel denominator unavailable; coverage remains null, not zero.",
	N4: "Reproducibility requires pinned archive/model/checksum; changed inputs invalidate comparisons.",
	reference: "docs/data/sprint-3-nrt-qa-reproducibility.md",
	transferReference: "docs/data/harmonization.md",
});
