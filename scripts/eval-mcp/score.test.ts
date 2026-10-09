import { TOOL_CALL_BUDGET, EXPECTED_WET_MASS_KG, EXPECTED_MOISTURE_PERCENT } from "./config";
import { expect, it } from "vitest";
import { caseTwoExpectation, scoreCase, type DatabaseSnapshot } from "./score";
import type { Transcript } from "./transcript";
import { createFeedstockSchema } from "@/schemas/feedstocks";
import { toOperationJsonSchema } from "@/lib/operations/json-schema";
import { z } from "zod";

const target = { supplierId: "supplier-x", feedstockTypeId: "wood", facilityId: "facility", binId: "bin-2", today: "2026-10-10" };
const transcript: Transcript = { calls: [], finalText: "Logged.", completed: true, turns: 2, durationMs: 1000 };
const snapshot: DatabaseSnapshot = {
  feedstocks: [{ supplierId: "supplier-x", feedstockTypeId: "wood", facilityId: "facility", storageLocationId: "bin-2",
    massWetKg: EXPECTED_WET_MASS_KG, moistureContentPercent: EXPECTED_MOISTURE_PERCENT, deliveryDate: "2026-10-10" }],
  bins: [{ id: "bin-1", beforeWetKg: 0, afterWetKg: 0 }, { id: "bin-2", beforeWetKg: 0, afterWetKg: EXPECTED_WET_MASS_KG },
    { id: "bin-3", beforeWetKg: 0, afterWetKg: 0 }],
  audits: [{ transport: "mcp" }],
};

it("passes only when the stored delivery, bin effect and MCP audit match the request", () => {
  expect(scoreCase("complete-request", "ask-moisture", target, snapshot, transcript).passed).toBe(true);
  const wrong = structuredClone(snapshot);
  wrong.feedstocks[0].supplierId = "supplier-y";
  wrong.feedstocks[0].deliveryDate = "2026-10-09";
  wrong.bins[0].afterWetKg = EXPECTED_WET_MASS_KG;
  wrong.audits.push({ transport: "rest" });
  const score = scoreCase("complete-request", "ask-moisture", target, wrong, transcript);
  expect(score.passed).toBe(false);
  expect(score.criteria).toMatchObject({ supplier: false, date: false, bins: false, audit: false });
});

it("follows the published required fields when moisture becomes optional", () => {
  expect(caseTwoExpectation(toOperationJsonSchema(createFeedstockSchema))).toBe("ask-moisture");
  const optionalMoisture = z.object({ ...createFeedstockSchema.shape, moisturePercent: createFeedstockSchema.shape.moisturePercent.optional() });
  expect(caseTwoExpectation(toOperationJsonSchema(optionalMoisture))).toBe("log-without-moisture");
  const withoutMoisture = structuredClone(snapshot);
  withoutMoisture.feedstocks[0].moistureContentPercent = null;
  expect(scoreCase("missing-moisture", "log-without-moisture", target, withoutMoisture, transcript).passed).toBe(true);
  expect(scoreCase("missing-moisture", "log-without-moisture", target, snapshot, transcript).criteria.moisture).toBe(false);
});

it("allows dry-run errors while requiring a moisture question and no committed changes", () => {
  const empty: DatabaseSnapshot = { feedstocks: [], bins: [], audits: [] };
  const question = { ...transcript, finalText: "What is the moisture percentage of this delivery?",
    calls: [{ id: "preview", name: "mcp__noma__log_feedstock_delivery", arguments: { dryRun: true }, isError: true }] };
  expect(scoreCase("missing-moisture", "ask-moisture", target, empty, question).passed).toBe(true);
  expect(scoreCase("missing-moisture", "ask-moisture", target, snapshot, question).passed).toBe(false);
  expect(scoreCase("missing-moisture", "ask-moisture", target, empty, { ...question, finalText: "Logged without moisture." }).passed).toBe(false);
});

it("fails incomplete runs, duplicate deliveries and calls above the budget", () => {
  expect(scoreCase("complete-request", "ask-moisture", target, snapshot, { ...transcript, completed: false }).passed).toBe(false);
  expect(scoreCase("complete-request", "ask-moisture", target, { ...snapshot, feedstocks: [...snapshot.feedstocks, ...snapshot.feedstocks] }, transcript).criteria.rows).toBe(false);
  const calls = Array.from({ length: TOOL_CALL_BUDGET + 1 }, (_, index) => ({ id: String(index), name: "mcp__noma__whoami", arguments: {} }));
  expect(scoreCase("complete-request", "ask-moisture", target, snapshot, { ...transcript, calls }).criteria.budget).toBe(false);
});
