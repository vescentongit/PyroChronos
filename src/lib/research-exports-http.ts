import type { LocationDatabase } from "./monitoring-locations.ts";
import {
	createResearchExport,
	readResearchExport,
	getResearchExportDownload,
	getResearchExportManifest,
} from "./research-exports.ts";
import {
	privateResearchJson,
	researchRequestBody,
	withPrivateResearchRequest,
	type ResearchHttpDependencies,
} from "./research-http.ts";
import type { ResearchExportStorage } from "./research-export-storage.ts";
import { fail } from "./research-store.ts";

interface Dependencies extends ResearchHttpDependencies {
	database(): LocationDatabase;
	storage(): ResearchExportStorage;
}
interface Context {
	params: Promise<{ workspaceId: string; exportId?: string }>;
}
export function createResearchExportHandlers(dependencies: Dependencies) {
	function handle(
		request: Request,
		context: Context,
		action: "create" | "status" | "download" | "manifest",
	) {
		return withPrivateResearchRequest(request, dependencies, async (userId) => {
			if (new URL(request.url).search) fail("INVALID_REQUEST");
			const params = await context.params;
			const service = {
				database: dependencies.database(),
				storage: {
					put: (key: string, bytes: Uint8Array) =>
						dependencies.storage().put(key, bytes),
					putStream: (key: string, bytes: AsyncIterable<Uint8Array>) =>
						dependencies.storage().putStream(key, bytes),
					verify: (key: string, checksum: string, bytes: number) =>
						dependencies.storage().verify(key, checksum, bytes),
					read: (key: string, checksum: string, bytes: number) =>
						dependencies.storage().read(key, checksum, bytes),
				},
			};
			if (action === "create") {
				const receipt = await createResearchExport(
					service,
					params.workspaceId,
					userId,
					await researchRequestBody(request),
				);
				return privateResearchJson(receipt.value, receipt.status);
			}
			const id = params.exportId ?? fail("NOT_FOUND", 404);
			if (action === "status")
				return privateResearchJson(
					await readResearchExport(service, params.workspaceId, userId, id),
				);
			if (action === "manifest")
				return privateResearchJson(
					await getResearchExportManifest(
						service,
						params.workspaceId,
						userId,
						id,
					),
				);
			const file = await getResearchExportDownload(
				service,
				params.workspaceId,
				userId,
				id,
			);
			const iterator = file.content[Symbol.asyncIterator]();
			const stream = new ReadableStream<Uint8Array>({
				async pull(controller) {
					try {
						const item = await iterator.next();
						if (item.done) controller.close();
						else controller.enqueue(item.value);
					} catch {
						controller.error("EXPORT_STREAM_FAILED");
					}
				},
				async cancel() {
					await iterator.return?.();
				},
			});
			return new Response(stream, {
				headers: {
					"Cache-Control": "private, no-store",
					"Content-Type": "text/csv; charset=utf-8",
					"Content-Disposition": `attachment; filename="${file.filename}"`,
					"X-Content-Type-Options": "nosniff",
				},
			});
		});
	}
	return {
		POST: (request: Request, context: Context) =>
			handle(request, context, "create"),
		GET: (request: Request, context: Context) =>
			handle(request, context, "status"),
		downloadGET: (request: Request, context: Context) =>
			handle(request, context, "download"),
		manifestGET: (request: Request, context: Context) =>
			handle(request, context, "manifest"),
	};
}
