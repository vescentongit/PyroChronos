import assert from "node:assert/strict";
import { test } from "node:test";
import { canTransitionAssignment } from "../src/lib/research-inspection-contracts.ts";
import {
	inspectionPage,
	validateInspectionTime,
} from "../src/lib/research-inspection-store.ts";
import { cursorWrite } from "../src/lib/research-store.ts";

test("assignment transitions are explicit and terminal states cannot reopen", () => {
	const allowed = new Set([
		"assigned:in_progress",
		"assigned:completed",
		"assigned:cancelled",
		"in_progress:completed",
		"in_progress:cancelled",
	]);
	for (const from of ["assigned", "in_progress", "completed", "cancelled"]) {
		for (const to of ["assigned", "in_progress", "completed", "cancelled"]) {
			assert.equal(
				canTransitionAssignment(from, to, true),
				allowed.has(`${from}:${to}`),
			);
			assert.equal(
				canTransitionAssignment(from, to, false),
				allowed.has(`${from}:${to}`) && to !== "completed",
			);
		}
	}
});

test("inspection lists validate limits and bind cursors to their exact resource scope", () => {
	const scope = "reports:workspace:location";
	assert.equal(inspectionPage({}, scope).limit, 50);
	assert.equal(inspectionPage({ limit: "100" }, scope).limit, 100);
	for (const query of [
		{ limit: 0 },
		{ limit: 101 },
		{ limit: 2.5 },
		{ cursor: "broken" },
		{ unexpected: true },
	]) {
		assert.throws(
			() => inspectionPage(query, scope),
			(error) => error.code === "INVALID_REQUEST",
		);
	}
	const position = { id: "report", createdAt: "2026-08-01T00:00:00.000Z" };
	const cursor = cursorWrite(scope, JSON.stringify(position));
	assert.deepEqual(inspectionPage({ cursor }, scope).position, position);
	assert.throws(
		() => inspectionPage({ cursor }, "assignments:workspace:location"),
		(error) => error.code === "INVALID_REQUEST",
	);
});

test("inspection times preserve supported precision and use absolute UTC ordering", async () => {
	const database = {
		query: async () => [{ now: new Date("2026-11-13T00:00:00Z") }],
	};
	await validateInspectionTime(database, "2026-11-13T01:00:00+02:00");
	for (const time of ["2026-11-13T01:00:00Z", "2026-08-01T00:00:00.0001Z"]) {
		await assert.rejects(
			validateInspectionTime(database, time),
			(error) => error.code === "INVALID_REQUEST",
		);
	}
});
