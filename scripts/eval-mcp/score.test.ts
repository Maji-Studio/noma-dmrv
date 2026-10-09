import { TOOL_CALL_BUDGET, EXPECTED_WET_MASS_KG, EXPECTED_MOISTURE_PERCENT, EXPECTED_DRAW_WET_MASS_KG, FACILITY_TIME_ZONE } from "./config";
import { expect, it } from "vitest";
import { caseTwoExpectation, scoreCase, type DatabaseSnapshot } from "./score";
import type { Transcript } from "./transcript";
import { createProductionRunInput } from "@/schemas/production-run-input";
import { createFeedstockSchema } from "@/schemas/feedstocks";
import { toOperationJsonSchema } from "@/lib/operations/json-schema";
import { z } from "zod";

const target = { supplierId: "supplier-x", feedstockTypeId: "wood", facilityId: "facility", binId: "bin-2", today: "2026-10-10", reactorId: "reactor-1", timeZone: FACILITY_TIME_ZONE };
const transcript: Transcript = { calls: [], finalText: "Logged.", completed: true, turns: 2, durationMs: 1000 };
const snapshot: DatabaseSnapshot = {
  feedstocks: [{ supplierId: "supplier-x", feedstockTypeId: "wood", facilityId: "facility", storageLocationId: "bin-2",
    massWetKg: EXPECTED_WET_MASS_KG, moistureContentPercent: EXPECTED_MOISTURE_PERCENT, deliveryDate: "2026-10-10" }],
  bins: [{ id: "bin-1", beforeWetKg: 0, afterWetKg: 0 }, { id: "bin-2", beforeWetKg: 0, afterWetKg: EXPECTED_WET_MASS_KG },
    { id: "bin-3", beforeWetKg: 0, afterWetKg: 0 }],
  runs: [], draws: [],
  audits: [{ transport: "mcp", operationId: "log_feedstock_delivery" }],
};

it("passes only when the stored delivery, bin effect and MCP audit match the request", () => {
  expect(scoreCase("complete-request", "ask-moisture", target, snapshot, transcript).passed).toBe(true);
  const wrong = structuredClone(snapshot);
  wrong.feedstocks[0].supplierId = "supplier-y";
  wrong.feedstocks[0].deliveryDate = "2026-10-09";
  wrong.bins[0].afterWetKg = EXPECTED_WET_MASS_KG;
  wrong.audits.push({ transport: "rest", operationId: "log_feedstock_delivery" });
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
  const empty: DatabaseSnapshot = { feedstocks: [], bins: [], audits: [], runs: [], draws: [] };
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

const run = { id: "run-1", facilityId: target.facilityId, reactorId: target.reactorId, status: "running",
  // UTC day differs from the facility day. The scorer must use the facility zone.
  startTime: "2026-10-09T22:00:00Z" };
const massQuestion = { ...transcript, finalText: "The delivery is logged. I still need the wet draw mass for the run." };

it.each([false, true])("passes omitted mass with a mass request and a draw-free run saved: %s", (saved) => {
  const state = structuredClone(snapshot);
  if (saved) {
    state.runs.push(run);
    state.audits.push({ transport: "mcp", operationId: "start_production_run" });
  }
  expect(scoreCase("chained-mass-omitted", "ask-moisture", target, state, massQuestion).passed).toBe(true);
  expect(scoreCase("chained-mass-omitted", "ask-moisture", target, state, transcript).criteria.needsDrawMass).toBe(false);
});

it.each([0, EXPECTED_DRAW_WET_MASS_KG])("fails omitted mass on every saved draw, including %s kg", (wetMassKg) => {
  const state = structuredClone(snapshot);
  state.runs.push(run);
  state.draws.push({ productionRunId: run.id, storageLocationId: target.binId, wetMassKg });
  expect(scoreCase("chained-mass-omitted", "ask-moisture", target, state, massQuestion).criteria.noInventedDraw).toBe(false);
});

function completeSnapshot(): DatabaseSnapshot {
  const state = structuredClone(snapshot);
  state.runs.push(run);
  state.draws.push({ productionRunId: run.id, storageLocationId: target.binId, wetMassKg: EXPECTED_DRAW_WET_MASS_KG });
  state.bins.find((bin) => bin.id === target.binId)!.afterWetKg -= EXPECTED_DRAW_WET_MASS_KG;
  state.audits.push({ transport: "mcp", operationId: "start_production_run" });
  return state;
}

it("scores the complete chain's intake, run, facility date, explicit draw and remaining stock", () => {
  expect(scoreCase("chained-complete", "ask-moisture", target, completeSnapshot(), transcript).passed).toBe(true);
});

it.each([
  "reactor", "status", "facility", "date", "invalid-date", "draw-bin", "draw-mass", "draw-run",
  "stock", "duplicate-run", "duplicate-draw", "missing-run", "intake", "audit",
])("fails a complete chain with incorrect %s", (field) => {
  const state = completeSnapshot();
  if (field === "reactor") state.runs[0].reactorId = "other";
  if (field === "status") state.runs[0].status = "draft";
  if (field === "facility") state.runs[0].facilityId = "other";
  if (field === "date") state.runs[0].startTime = "2026-10-09T10:00:00Z";
  if (field === "invalid-date") state.runs[0].startTime = "invalid";
  if (field === "draw-bin") state.draws[0].storageLocationId = "other";
  if (field === "draw-mass") state.draws[0].wetMassKg = EXPECTED_WET_MASS_KG;
  if (field === "draw-run") state.draws[0].productionRunId = "other";
  if (field === "stock") state.bins[1].afterWetKg = EXPECTED_WET_MASS_KG;
  if (field === "duplicate-run") state.runs.push({ ...run, id: "run-2" });
  if (field === "duplicate-draw") state.draws.push({ ...state.draws[0] });
  if (field === "missing-run") state.runs = [];
  if (field === "intake") state.feedstocks[0].moistureContentPercent = null;
  if (field === "audit") state.audits[1].transport = "rest";
  expect(scoreCase("chained-complete", "ask-moisture", target, state, transcript).passed).toBe(false);
});

it.each(["reactor", "status", "duplicate", "moisture", "stock"])("fails the mass-omitted chain with incorrect %s", (field) => {
  const state = structuredClone(snapshot);
  state.runs.push(run);
  state.audits.push({ transport: "mcp", operationId: "start_production_run" });
  if (field === "reactor") state.runs[0].reactorId = "other";
  if (field === "status") state.runs[0].status = "draft";
  if (field === "duplicate") state.runs.push({ ...run, id: "run-2" });
  if (field === "moisture") state.feedstocks[0].moistureContentPercent = null;
  if (field === "stock") state.bins[1].afterWetKg = 0;
  expect(scoreCase("chained-mass-omitted", "ask-moisture", target, state, massQuestion).passed).toBe(false);
});

it("reads omitted run inputs from the published contract: resolve references and start time without inventing a draw", () => {
  const contract = toOperationJsonSchema(createProductionRunInput);
  expect(contract.required).toEqual(["facilityId", "reactorId", "startTime"]);
  expect(contract.required).not.toContain("feedstockDraws");
  expect(contract.required).not.toContain("feedstockMoisturePercent");
});

it.each([
  ["How much wet feedstock should I draw for R1?", true],
  ["What wet mass should I use?", true],
  ["The mass is still needed.", true],
  ["No need to specify the run draw mass.", false],
  ["The draw mass is not required.", false],
  ["Logged and started the run without draws.", false],
] as const)("recognizes a missing-mass request: %s", (finalText, expected) => {
  expect(scoreCase("chained-mass-omitted", "ask-moisture", target, snapshot, { ...transcript, finalText }).criteria.needsDrawMass).toBe(expected);
});
