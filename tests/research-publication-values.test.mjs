import assert from "node:assert/strict";
import { test } from "node:test";
import {
	assertPublicationMetadataSafe,
	assertPublicationSafe,
	publicationSecrets,
} from "../src/lib/research-publication-values.ts";

const unsafe = (run) =>
	assert.throws(run, (error) => error.code === "UNSAFE_METADATA");

test("UUID secrets block every casing in metadata, keys and artifact bytes", () => {
	const token = "abcdefab-abcd-4abc-8abc-abcdefabcdef";
	for (const configured of [token, token.toUpperCase()]) {
		const secrets = publicationSecrets([configured]);
		for (const variant of [
			token,
			token.toUpperCase(),
			"aBcDeFaB-AbCd-4aBc-8AbC-aBcDeFaBcDeF",
		]) {
			unsafe(() =>
				assertPublicationMetadataSafe({ revision: variant }, secrets),
			);
			unsafe(() => assertPublicationMetadataSafe({ [variant]: true }, secrets));
			unsafe(() =>
				assertPublicationSafe(Buffer.from(`prefix:${variant}:suffix`), secrets),
			);
		}
	}
});

test("ordinary credentials retain case-sensitive comparisons", () => {
	const secrets = publicationSecrets(["MixedCaseCredential-sentinel"]);
	unsafe(() => assertPublicationSafe("MixedCaseCredential-sentinel", secrets));
	assertPublicationSafe("mixedcasecredential-sentinel", secrets);
});

for (const name of [
	"DATABASE_URL",
	"DIRECT_URL",
	"RESEARCH_DATABASE_DSN",
	"DB_CONNECTION_STRING",
]) {
	test(`${name} credentials are blocked independently in encoded and decoded forms`, () => {
		const previous = process.env[name];
		const username = "publication-user@sentinel";
		const password = 'Publication-Pass/word:"sentinel';
		process.env[name] =
			`postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@127.0.0.1/research_worker_test`;
		try {
			const secrets = publicationSecrets();
			for (const credential of [username, password]) {
				for (const variant of [credential, encodeURIComponent(credential)]) {
					unsafe(() =>
						assertPublicationMetadataSafe(
							{ archiveRevision: variant },
							secrets,
						),
					);
					unsafe(() => assertPublicationSafe(Buffer.from(variant), secrets));
				}
			}
		} finally {
			if (previous === undefined) delete process.env[name];
			else process.env[name] = previous;
		}
	});
}

test("malformed URL escapes do not disable credential scanning", () => {
	const previous = process.env.DATABASE_URL;
	process.env.DATABASE_URL =
		"postgresql://publication-user:pass%ZZsentinel@127.0.0.1/test";
	try {
		unsafe(() =>
			assertPublicationSafe("pass%ZZsentinel", publicationSecrets()),
		);
	} finally {
		if (previous === undefined) delete process.env.DATABASE_URL;
		else process.env.DATABASE_URL = previous;
	}
});
