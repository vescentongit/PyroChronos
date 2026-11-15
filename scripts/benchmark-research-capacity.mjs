import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import {
	mkdtemp,
	rm,
	readFile,
	readdir,
	stat,
	writeFile,
	mkdir,
} from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir, cpus, totalmem, release } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

registerHooks({
	resolve(specifier, context, next) {
		if (specifier.startsWith("@/"))
			return next(
				pathToFileURL(resolve("src", `${specifier.slice(2)}.ts`)).href,
				context,
			);
		if (
			context.parentURL?.includes("/src/lib/") &&
			specifier.startsWith("./") &&
			!/\.[a-z]+$/i.test(specifier)
		)
			return next(`${specifier}.ts`, context);
		return next(specifier, context);
	},
});
const { POST } = await import("../src/app/api/local-research/route.ts");
const { validateProducerBundle } = await import("../src/lib/research-store.ts");
const python =
	process.env.RESEARCH_PYTHON ||
	resolve(".cache/ingest-venv/Scripts/python.exe");
process.env.RESEARCH_PYTHON = python;
const command = (args, input) =>
	new Promise((resolveRun, reject) => {
		const child = spawn(python, args, { stdio: ["pipe", "pipe", "pipe"] });
		const out = [],
			err = [];
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error("Benchmark child timeout"));
		}, 300_000);
		child.on("error", reject);
		child.stdout.on("data", (data) => out.push(data));
		child.stderr.on("data", (data) => err.push(data));
		child.on("close", (code) => {
			clearTimeout(timer);
			if (code !== 0)
				reject(new Error(`Benchmark child failed: ${Buffer.concat(err)}`));
			else resolveRun(JSON.parse(Buffer.concat(out).toString()));
		});
		child.stdin.end(input ? JSON.stringify(input) : undefined);
	});
const call = (body) =>
	POST(
		new Request("http://localhost/api/local-research", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		}),
	);
const root = await mkdtemp(join(tmpdir(), "pyro-capacity-"));
const previousRoot = process.env.RESEARCH_DATA_DIR;
const rows = [];
const timed = async (name, fn) => {
	const start = performance.now();
	const value = await fn();
	rows.push({ name, elapsedMs: performance.now() - start, ...value });
	return value;
};
try {
	const fixture = await command([
		"scripts/benchmark-research-capacity.py",
		"fixture",
		root,
	]);
	process.env.RESEARCH_DATA_DIR = join(root, "store");
	let saved, lastBody;
	for (const [size, west, south, east, north] of [
		["small", 113.9, -2.5, 114.2, -2.2],
		["large", 110, -5, 120, 0],
	]) {
		const geometry = {
			type: "Polygon",
			coordinates: [
				[
					[west, south],
					[east, south],
					[east, north],
					[west, north],
					[west, south],
				],
			],
		};
		const response = await call({
			action: "area",
			workspaceId: "benchmark",
			area: { requestId: randomUUID(), name: `Synthetic ${size}`, geometry },
		});
		assert.equal(response.status, 200);
		const area = await response.json();
		assert.deepEqual(area.geometry, geometry);
		for (const [duration, start, end] of [
			["short", "2019-09-01", "2019-09-30"],
			["long", "2019-01-01", "2019-12-31"],
		]) {
			const request = {
				requestId: randomUUID(),
				areaId: area.id,
				areaRevision: 1,
				period: { start, end },
				comparisonPeriod: null,
				baseline: { kind: "rolling-same-calendar-period", windowYears: 10 },
				referenceScale: "MODIS-equivalent",
				qualityPolicyVersion: "quality-policy-1",
				monitoringLocationId: null,
			};
			const body = {
				action: "analyze",
				workspaceId: "benchmark",
				area,
				request,
			};
			for (let repeat = 0; repeat < 3; repeat++) {
				const run = {
					id: randomUUID(),
					workspaceId: "benchmark",
					input: {
						...request,
						area,
						dataset: {
							fingerprint: "",
							sources: ["MODIS_SP", "VIIRS_SNPP_SP"],
							qualityPolicyVersion: "quality-policy-1",
							producerVersion: "research-harmonized-1",
						},
					},
				};
				await timed(`producer/${size}/${duration}`, async () => {
					const measured = await command(
						["scripts/benchmark-research-capacity.py", "probe"],
						{ root: process.env.RESEARCH_DATA_DIR, run },
					);
					// Probe computes the fingerprint; validation does not use this field.
					validateProducerBundle(run, measured.bundle);
					assert.deepEqual(measured.bundle.result.area.geometry, geometry);
					return {
						repeat,
						areaKm2: area.areaKm2,
						geometryHash: area.geometryHash,
						period: request.period,
						...measured.resources,
						subprocessWallIncludesStartup: false,
						observations: measured.bundle.detections.reduce(
							(n, p) => n + p.observations.length,
							0,
						),
						outputBytes: Buffer.byteLength(JSON.stringify(measured.bundle)),
					};
				});
			}
			await timed(`route/${size}/${duration}/miss`, async () => {
				const result = await call(body);
				assert.equal(result.status, 200);
				saved = await result.json();
				assert.deepEqual(saved.result.area.geometry, geometry);
				return {
					status: result.status,
					outputBytes: Buffer.byteLength(JSON.stringify(saved)),
					id: saved.result.id,
				};
			});
			lastBody = body;
		}
	}
	const previousId = saved.result.id;
	await timed("route/identical-resubmission/no-server-cache", async () => {
		const result = await call(lastBody);
		assert.equal(result.status, 200);
		const bundle = await result.json();
		assert.notEqual(bundle.result.id, previousId);
		return { status: result.status, distinctResult: true };
	});
	// A deterministic IndexedDB double isolates client validation/cache costs.
	// Its time is NOT browser disk latency or browser quota evidence.
	let reads = 0;
	globalThis.indexedDB = {
		open() {
			const request = {
				result: {
					close() {},
					transaction() {
						return {
							objectStore() {
								return {
									get() {
										reads++;
										const op = { result: structuredClone(saved) };
										queueMicrotask(() => op.onsuccess());
										return op;
									},
								};
							},
						};
					},
				},
			};
			queueMicrotask(() => request.onsuccess());
			return request;
		},
	};
	const { getBundle } = await import("../src/lib/local-research-client.ts");
	await timed("client/cache-miss/idb-double", async () => {
		await getBundle(saved.result.id);
		assert.equal(reads, 1);
		return { reads };
	});
	for (const concurrency of [2, 4, 8]) {
		await timed(`route/concurrency-${concurrency}`, async () => {
			const pending = Array.from({ length: concurrency }, () => call(lastBody));
			const old = await getBundle(saved.result.id);
			assert.equal(old.result.id, saved.result.id);
			const statuses = await Promise.all(
				pending.map(async (p) => (await p).status),
			);
			assert.equal(statuses.filter((s) => s === 200).length, 1);
			assert.equal(statuses.filter((s) => s === 503).length, concurrency - 1);
			return { statuses, oldResultReadable: true };
		});
	}
	for (let repeat = 0; repeat < 3; repeat++)
		await timed("client/cache-hit/idb-double", async () => {
			const before = reads;
			await Promise.all(
				Array.from({ length: 8 }, () => getBundle(saved.result.id)),
			);
			assert.equal(reads, before);
			return { repeat, concurrency: 8, reads: reads - before };
		});
	const inventory = [];
	async function walk(dir) {
		for (const entry of await readdir(dir, { withFileTypes: true })) {
			const file = join(dir, entry.name);
			if (entry.isDirectory()) await walk(file);
			else
				inventory.push({
					bytes: (await stat(file)).size,
					hash: createHash("sha256")
						.update(await readFile(file))
						.digest("hex"),
				});
		}
	}
	await walk(process.env.RESEARCH_DATA_DIR);
	const provenance = {
		baseCommit: execFileSync("git", ["rev-parse", "HEAD"], {
			encoding: "utf8",
		}).trim(),
		python: execFileSync(python, ["--version"], { encoding: "utf8" }).trim(),
		modelFiles: [],
	};
	for (const name of (await readdir("pipeline/models")).sort()) {
		if (name.endsWith(".json"))
			provenance.modelFiles.push({
				name,
				sha256: createHash("sha256")
					.update(await readFile(join("pipeline/models", name)))
					.digest("hex"),
			});
	}
	const report = {
		schemaVersion: "capacity-benchmark-1",
		measuredAt: new Date().toISOString(),
		fixture,
		provenance,
		environment: {
			platform: process.platform,
			release: release(),
			node: process.version,
			cpu: cpus()[0].model,
			logicalCpus: cpus().length,
			totalMemoryBytes: totalmem(),
		},
		methodology: {
			repeats: 3,
			osCache: "uncontrolled warm/cold; no disk cache flush",
			producerResources:
				"fresh Python process; peak RSS process lifetime; CPU and IO deltas around fingerprint+produce; Windows transfer counters include cached IO, not physical disk",
			route:
				"direct production POST handler; real Python subprocesses, no HTTP/Next overhead",
			clientCache:
				"production getBundle with synthetic IndexedDB double, not browser storage benchmark",
			costs: "external deployment rates excluded; no ETA extrapolation",
		},
		nativePostgres: {
			report: "bagas-sprint-3-native.json",
			scope: "separate command; this file contains no native DB measurements",
		},
		dataset: {
			files: inventory.length,
			bytes: inventory.reduce((n, f) => n + f.bytes, 0),
			contentHash: createHash("sha256")
				.update(JSON.stringify(inventory))
				.digest("hex"),
		},
		nodePeakRssBytes: process.resourceUsage().maxRSS * 1024,
		rows,
	};
	const output =
		process.argv[2] || "docs/benchmarks/bagas-sprint-3-capacity.json";
	await mkdir(resolve(output, ".."), { recursive: true });
	await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
	console.log(
		JSON.stringify({ output, rows: rows.length, dataset: report.dataset }),
	);
} finally {
	if (previousRoot === undefined) delete process.env.RESEARCH_DATA_DIR;
	else process.env.RESEARCH_DATA_DIR = previousRoot;
	await rm(root, { recursive: true, force: true });
}
