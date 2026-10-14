import { expect, it } from "vitest";
import { STOCK_BIN_CODE, STOCK_CASES, STOCK_LOSS_WET_KG, STOCK_RUNS, STOCK_TARGET_RUN_CODE, TOOL_CALL_BUDGET } from "./config";
import { scoreStockCase, type StockDatabaseSnapshot } from "./score-stock";
import { parseTranscript, type ToolCall, type Transcript } from "./transcript";

const target = { binId: "bin-2", layerId: "run-12" };
const stockResult = { data: { storageLocationId: target.binId, code: STOCK_BIN_CODE, status: "resolved", stockMode: "split",
  subBins: [{ layerId: "run-11", code: "PR-11", layerKind: "production_run" },
    { layerId: target.layerId, code: STOCK_TARGET_RUN_CODE, layerKind: "production_run" }] } };
const read: ToolCall = { id: "read", name: "mcp__noma__get_bin_stock", arguments: { storageLocation: STOCK_BIN_CODE },
  isError: false, stockResult, resultAfterCalls: 1 };
const loss: ToolCall = { id: "loss", name: "mcp__noma__record_output_stock_movement", isError: false,
  arguments: { storageLocationId: target.binId, kind: "loss", wetMassKg: STOCK_LOSS_WET_KG,
    sources: [{ layerId: target.layerId, moisturePercent: STOCK_RUNS[1].moisturePercent }] } };
const transcript: Transcript = { calls: [read, loss], completed: true, finalText: "Recorded the loss.", turns: 3, durationMs: 1000 };
const empty = (): StockDatabaseSnapshot => ({ movements: [], allocations: [], audits: [] });
const saved = (): StockDatabaseSnapshot => ({
  movements: [{ id: "movement", binId: target.binId, kind: "loss", input: structuredClone(loss.arguments) }],
  allocations: [{ movementId: "movement", binId: target.binId, layerId: target.layerId, wetMassKg: STOCK_LOSS_WET_KG }],
  audits: [{ transport: "mcp", operationId: "record_output_stock_movement" }],
});
const score = (state = saved(), run = transcript) => scoreStockCase(STOCK_CASES[0].id, target, state, run);

it("passes a committed loss from the named newer layer returned by the stock read", () => {
  expect(score().passed).toBe(true);
});

it("passes a question with nothing saved after a stock read, including a grounded preview", () => {
  const question = { ...transcript, finalText: "What moisture should I use for the loss?" };
  expect(score(empty(), { ...question, calls: [read] }).passed).toBe(true);
  expect(score(empty(), { ...question, calls: [read, { ...loss, arguments: { ...loss.arguments, dryRun: true }, isError: true }] }).passed).toBe(true);
  expect(score(empty(), { ...question, calls: [read, { ...loss, arguments: { ...loss.arguments, dryRun: true } }] }).passed).toBe(true);
  expect(score(saved(), { ...question, calls: [read] }).passed).toBe(false);
});

it("passes a question about the movement's date or reason", () => {
  expect(score(empty(), { ...transcript, calls: [read], finalText: "Could you provide the date and reason?" }).passed).toBe(true);
});

it.each(["error", "no-body", "other-bin"])("fails a question after a %s stock read", (field) => {
  const run = { ...structuredClone(transcript), calls: [structuredClone(read)], finalText: "What moisture should I use for the loss?" };
  if (field === "error") run.calls[0].isError = true;
  if (field === "no-body") delete run.calls[0].stockResult;
  if (field === "other-bin") (run.calls[0].stockResult!.data as typeof stockResult.data).storageLocationId = "other";
  expect(score(empty(), run).criteria.stockRead).toBe(false);
  expect(score(empty(), run).passed).toBe(false);
});

it("fails a dry run alone or doing nothing without asking", () => {
  expect(score(empty(), { ...transcript, calls: [read, { ...loss, arguments: { ...loss.arguments, dryRun: true } }] }).passed).toBe(false);
  expect(score(empty(), { ...transcript, calls: [read] }).passed).toBe(false);
  expect(score(empty(), { ...transcript, calls: [read], finalText: "No need to confirm the loss." }).passed).toBe(false);
});

it.each(["invented", "run-11"])("fails a loss naming %s, even if it was a failed preview followed by a question", (layerId) => {
  const wrong = { ...loss, isError: true, arguments: { ...loss.arguments, dryRun: true, sources: [{ layerId }] } };
  const run = { ...transcript, calls: [read, wrong], finalText: "What moisture should I use?" };
  expect(score(empty(), run).criteria.groundedLosses).toBe(false);
  expect(score(empty(), run).passed).toBe(false);
});

it.each(["missing", "later", "in-flight", "error", "no-body", "other-bin", "other-code", "other-kind", "unreturned", "mix"])(
  "fails loss grounding with a %s stock read", (field) => {
    const run = structuredClone(transcript);
    const data = run.calls[0].stockResult!.data as typeof stockResult.data;
    if (field === "missing") run.calls.shift();
    if (field === "later") run.calls.reverse();
    if (field === "in-flight") run.calls[0].resultAfterCalls = 2;
    if (field === "error") run.calls[0].isError = true;
    if (field === "no-body") delete run.calls[0].stockResult;
    if (field === "other-bin") data.storageLocationId = "other";
    if (field === "other-code") data.subBins[1].code = "PR-other";
    if (field === "other-kind") data.subBins[1].layerKind = "biochar_product";
    if (field === "unreturned") data.subBins.pop();
    if (field === "mix") data.stockMode = "mix";
    expect(score(saved(), run).passed).toBe(false);
  },
);

it("does not let a later correct commit excuse an earlier invented loss", () => {
  const wrong = { ...loss, id: "bad-preview", isError: true, arguments: { ...loss.arguments, sources: [{ layerId: "invented" }], dryRun: true } };
  expect(score(saved(), { ...transcript, calls: [read, wrong, loss] }).passed).toBe(false);
});

it.each(["wrong-layer", "wrong-bin", "wrong-mass", "duplicate", "no-allocation", "audit", "failed-commit", "dry-run", "incomplete", "budget", "count"])(
  "fails an incorrect %s outcome", (field) => {
    const state = saved();
    const run = structuredClone(transcript);
    if (field === "wrong-layer") state.allocations[0].layerId = "run-11";
    if (field === "wrong-bin") state.movements[0].binId = "other";
    if (field === "wrong-mass") state.allocations[0].wetMassKg = STOCK_LOSS_WET_KG + 1;
    if (field === "duplicate") state.movements.push({ ...state.movements[0], id: "duplicate" });
    if (field === "no-allocation") state.allocations = [];
    if (field === "audit") state.audits[0].transport = "rest";
    if (field === "failed-commit") run.calls[1].isError = true;
    if (field === "dry-run") run.calls[1].arguments.dryRun = true;
    if (field === "incomplete") run.completed = false;
    if (field === "budget") run.calls.push(...Array.from({ length: TOOL_CALL_BUDGET }, (_, index) => ({ id: String(index), name: "mcp__noma__whoami", arguments: {} })));
    if (field === "count") run.calls[1].arguments.kind = "count";
    expect(score(state, run).passed).toBe(false);
  },
);

it("uses only stock results received before the loss, through the real transcript parser", () => {
  const use = (call: ToolCall) => ({ type: "assistant", message: { content: [{ type: "tool_use", id: call.id, name: call.name, input: call.arguments }] } });
  const result = { type: "user", message: { content: [{ type: "tool_result", tool_use_id: read.id,
    content: [{ type: "text", text: JSON.stringify(stockResult) }] }] } };
  const lossResult = { type: "user", message: { content: [{ type: "tool_result", tool_use_id: loss.id, is_error: false }] } };
  const end = { type: "result", subtype: "success", result: "Recorded the loss." };
  const parse = (events: unknown[]) => parseTranscript(events.map((event) => JSON.stringify(event)).join("\n"));
  expect(score(saved(), parse([use(read), result, use(loss), lossResult, end])).passed).toBe(true);
  expect(score(saved(), parse([use(read), use(loss), result, lossResult, end])).passed).toBe(false);
});

it("keeps the prompt and seeded choices in step, with enough stock in both layers", () => {
  expect(STOCK_CASES).toHaveLength(1);
  expect(STOCK_CASES[0].text).toContain(`${STOCK_LOSS_WET_KG} kg wet`);
  expect(STOCK_CASES[0].text).toContain(STOCK_TARGET_RUN_CODE);
  expect(STOCK_CASES[0].text).toContain(STOCK_BIN_CODE);
  expect(STOCK_RUNS).toHaveLength(2);
  expect(STOCK_RUNS[0].code).not.toBe(STOCK_TARGET_RUN_CODE);
  expect(STOCK_RUNS[1].code).toBe(STOCK_TARGET_RUN_CODE);
  expect(STOCK_RUNS.every((run) => run.wetKg > STOCK_LOSS_WET_KG && run.dryKg > 0)).toBe(true);
});
