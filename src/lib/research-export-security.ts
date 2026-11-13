import { parse } from "csv-parse";
import { z } from "zod";
import {
	assertPublicationMetadataSafe,
	assertPublicationSafe,
} from "./research-publication-values.ts";
import { fail } from "./research-store.ts";

export async function assertExportCsvSafe(
	bytes: Uint8Array,
	secrets: readonly string[],
	expectedRows?: number,
): Promise<void> {
	try {
		assertPublicationSafe(bytes, secrets);
		const parser = parse({
			relax_column_count: false,
			max_record_size: 64 * 1024 * 1024,
		});
		parser.end(Buffer.from(bytes));
		let records = 0;
		for await (const record of parser) {
			assertPublicationMetadataSafe(z.array(z.string()).parse(record), secrets);
			records++;
		}
		if (
			!records ||
			(expectedRows !== undefined && records - 1 !== expectedRows)
		)
			return fail("DEPENDENCY_UNAVAILABLE", 503);
	} catch {
		return fail("DEPENDENCY_UNAVAILABLE", 503);
	}
}
