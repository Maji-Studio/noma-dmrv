import { STOCK_BIN_CODE, STOCK_LOSS_WET_KG, STOCK_TARGET_RUN_CODE, TOOL_CALL_BUDGET } from "./config";
import type { CaseScore } from "./score";
import type { ToolCall, Transcript } from "./transcript";

export interface StockTarget { binId: string; layerId: string }
export interface StockDatabaseSnapshot {
  movements: { id: string; binId: string; kind: string | null; input: Record<string, unknown> | null }[];
  allocations: { movementId: string; binId: string; layerId: string | null; wetMassKg: number | null }[];
  audits: { transport: string; operationId: string }[];
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isStockRead(call: ToolCall, target: StockTarget): boolean {
  const data = object(call.stockResult?.data);
  return call.name === "mcp__noma__get_bin_stock" && call.isError === false
    && data.storageLocationId === target.binId && data.code === STOCK_BIN_CODE
    && data.status === "resolved" && data.stockMode === "split";
}

function namesTarget(input: Record<string, unknown>, target: StockTarget): boolean {
  const sources = input.sources;
  return input.kind === "loss" && input.storageLocationId === target.binId && input.wetMassKg === STOCK_LOSS_WET_KG
    && Array.isArray(sources) && sources.length === 1 && object(sources[0]).layerId === target.layerId;
}

function groundedLoss(call: ToolCall, index: number, calls: ToolCall[], target: StockTarget): boolean {
  if (!namesTarget(call.arguments, target)) return false;
  return calls.slice(0, index).some((read) => {
    if (!isStockRead(read, target) || read.resultAfterCalls === undefined || read.resultAfterCalls > index) return false;
    const layers = object(read.stockResult?.data).subBins;
    // The named run's identity must come from a returned layer, not another lookup or a guessed UUID.
    return Array.isArray(layers) && layers.some((value) => {
      const layer = object(value);
      return layer.layerId === target.layerId && layer.code === STOCK_TARGET_RUN_CODE && layer.layerKind === "production_run";
    });
  });
}

function asksBeforeSaving(text: string): boolean {
  return text.split(/[.!\n]/).some((sentence) => /\b(?:moisture|loss|sub-bin|run|bin|time|when|date|reason|confirm)\b/i.test(sentence)
    && /\?|\b(?:provide|enter|tell|need|specify|supply|confirm)\b/i.test(sentence)
    && !/\b(?:no need|not needed|not required|do not need|don't need)\b/i.test(sentence));
}

/** Like the intake cases, success is a committed row; a dry run alone needs a question and no saved changes. */
export function scoreStockCase(
  caseId: string, target: StockTarget, snapshot: StockDatabaseSnapshot, transcript: Transcript,
): CaseScore {
  const writes = transcript.calls.filter((call) => call.name === "mcp__noma__record_output_stock_movement");
  const lossCalls = transcript.calls.filter((call) => call.name === "mcp__noma__record_output_stock_movement" && call.arguments.kind === "loss");
  const { movements, allocations, audits } = snapshot;
  const savedNothing = movements.length === 0 && allocations.length === 0 && audits.length === 0;
  const savedTarget = movements.length === 1 && movements[0].binId === target.binId && movements[0].kind === "loss"
    && namesTarget(movements[0].input ?? {}, target)
    && allocations.length === 1 && allocations[0].movementId === movements[0].id
    && allocations[0].binId === target.binId && allocations[0].layerId === target.layerId
    && allocations[0].wetMassKg === STOCK_LOSS_WET_KG
    && audits.length === 1 && audits[0].transport === "mcp" && audits[0].operationId === "record_output_stock_movement"
    && lossCalls.some((call) => call.arguments.dryRun !== true && call.isError === false);
  const criteria = {
    completed: transcript.completed,
    budget: transcript.calls.length <= TOOL_CALL_BUDGET,
    stockRead: transcript.calls.some((call) => isStockRead(call, target)),
    // Check failed previews too: asking later cannot excuse an invented layer or a loss before the read.
    groundedLosses: transcript.calls.every((call, index) => call.name !== "mcp__noma__record_output_stock_movement"
      || (call.arguments.kind === "loss" && groundedLoss(call, index, transcript.calls, target))),
    outcome: savedTarget || (savedNothing && asksBeforeSaving(transcript.finalText)),
    onlyLossWrites: writes.length === lossCalls.length,
  };
  return { caseId, expectation: "Read stock, then record the named run's loss or ask and save nothing",
    passed: Object.values(criteria).every(Boolean), criteria, toolCalls: transcript.calls.length,
    durationMs: transcript.durationMs, turns: transcript.turns };
}
