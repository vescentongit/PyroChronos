import { PrismaClient } from "@prisma/client";
import { registerHooks } from "node:module";
registerHooks({
	resolve(s, c, n) {
		return n(
			c.parentURL?.includes("/src/lib/") &&
				s.startsWith("./") &&
				!s.endsWith(".ts")
				? `${s}.ts`
				: s,
			c,
		);
	},
});
const { reconcileResearchObjects } = await import(
	"../src/lib/research-recovery.ts"
);
const { serverResearchRetentionPolicy } = await import(
	"../src/lib/research-retention.ts"
);
const client = new PrismaClient();
try {
	if (!process.env.RESEARCH_ARTIFACT_ROOT) throw new Error("ROOT_REQUIRED");
	const report = await reconcileResearchObjects(
		{ query: (q, p = []) => client.$queryRawUnsafe(q, ...p) },
		process.env.RESEARCH_ARTIFACT_ROOT,
		process.env.RESEARCH_RECOVERY_BACKUP_ROOT,
	);
	console.log(
		JSON.stringify({
			policy: "retain-private-no-delete",
			retention: serverResearchRetentionPolicy,
			objects: report,
		}),
	);
	if (
		report.some((row) =>
			["missing", "damaged-retained", "restore-unavailable"].includes(
				row.status,
			),
		)
	)
		process.exitCode = 2;
} catch {
	console.error("RECOVERY_FAILED");
	process.exitCode = 1;
} finally {
	await client.$disconnect();
}
