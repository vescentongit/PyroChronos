import { registerHooks } from "node:module";
import { PrismaClient } from "@prisma/client";
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
const { operationalStatus } = await import(
	"../src/lib/research-operational-status.ts"
);
const { assertPublicationSafe, publicationSecrets } = await import(
	"../src/lib/research-publication-values.ts"
);
let client;
try {
	client = new PrismaClient();
	const report = JSON.stringify(
		await operationalStatus({
			query: (q, p = []) => client.$queryRawUnsafe(q, ...p),
		}),
	);
	assertPublicationSafe(report, publicationSecrets());
	console.log(report);
} catch {
	console.error("OPERATIONAL_STATUS_UNAVAILABLE");
	process.exitCode = 1;
} finally {
	await client?.$disconnect();
}
