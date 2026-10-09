import { EXPECTED_MOISTURE_PERCENT, EXPECTED_WET_MASS_KG, MILLISECONDS_PER_SECOND, TOOL_CALL_BUDGET } from "./config";
import type { Transcript } from "./transcript";

export type CaseTwoExpectation = "ask-moisture" | "log-without-moisture";
export interface Target {
  supplierId: string;
  feedstockTypeId: string;
  facilityId: string;
  binId: string;
  today: string;
}
export interface DatabaseSnapshot {
  feedstocks: {
    supplierId: string | null;
    feedstockTypeId: string | null;
    facilityId: string;
    storageLocationId: string | null;
    massWetKg: number | null;
    moistureContentPercent: number | null;
    deliveryDate: string | null;
  }[];
  bins: { id: string; beforeWetKg: number; afterWetKg: number }[];
  audits: { transport: string }[];
}
export interface CaseScore {
  caseId: string;
  expectation: string;
  passed: boolean;
  criteria: Record<string, boolean>;
  toolCalls: number;
  durationMs: number | null;
  turns: number | null;
}

export function caseTwoExpectation(contract: Record<string, unknown>): CaseTwoExpectation {
  return Array.isArray(contract.required) && contract.required.includes("moisturePercent")
    ? "ask-moisture" : "log-without-moisture";
}

function asksForMoisture(text: string): boolean {
  return text.split(/[.!\n]/).some((sentence) => /\bmoisture\b/i.test(sentence)
    && /\?|\b(?:provide|enter|tell|need|what|how much|specify|supply|confirm)\b/i.test(sentence));
}

export function scoreCase(
  caseId: string, expectation: CaseTwoExpectation, target: Target,
  snapshot: DatabaseSnapshot, transcript: Transcript,
): CaseScore {
  const ask = caseId === "missing-moisture" && expectation === "ask-moisture";
  const row = snapshot.feedstocks[0];
  const criteria: Record<string, boolean> = {
    completed: transcript.completed,
    budget: transcript.calls.length <= TOOL_CALL_BUDGET,
  };
  if (ask) {
    Object.assign(criteria, {
      rows: snapshot.feedstocks.length === 0,
      asksMoisture: asksForMoisture(transcript.finalText),
      bins: snapshot.bins.every((bin) => bin.afterWetKg === bin.beforeWetKg),
      audit: snapshot.audits.length === 0,
    });
  } else {
    Object.assign(criteria, {
      rows: snapshot.feedstocks.length === 1,
      supplier: row?.supplierId === target.supplierId,
      type: row?.feedstockTypeId === target.feedstockTypeId,
      facility: row?.facilityId === target.facilityId,
      wetMass: row?.massWetKg === EXPECTED_WET_MASS_KG,
      moisture: caseId === "complete-request" ? row?.moistureContentPercent === EXPECTED_MOISTURE_PERCENT
        : row?.moistureContentPercent == null && !!row,
      date: row?.deliveryDate === target.today,
      bins: row?.storageLocationId === target.binId && snapshot.bins.some((bin) => bin.id === target.binId)
        && snapshot.bins.every((bin) => bin.afterWetKg - bin.beforeWetKg === (bin.id === target.binId ? EXPECTED_WET_MASS_KG : 0)),
      audit: snapshot.audits.length === 1 && snapshot.audits[0].transport === "mcp",
    });
  }
  return { caseId, expectation: ask ? "Ask for moisture; save nothing" : caseId === "complete-request"
    ? "Log with 32% moisture" : "Log with moisture absent",
  passed: Object.values(criteria).every(Boolean), criteria, toolCalls: transcript.calls.length,
  durationMs: transcript.durationMs, turns: transcript.turns };
}

export function markdownReport(scores: CaseScore[]): string {
  const columns = [...new Set(scores.flatMap((score) => Object.keys(score.criteria)))];
  const header = ["Case", "Expectation", "Result", ...columns, "Tool calls", "Turns", "Duration"];
  const rows = scores.map((score) => [score.caseId, score.expectation, score.passed ? "PASS" : "FAIL",
    ...columns.map((column) => column in score.criteria ? score.criteria[column] ? "PASS" : "FAIL" : "n/a"),
    `${score.toolCalls}/${TOOL_CALL_BUDGET}`, String(score.turns ?? "n/a"),
    score.durationMs === null ? "n/a" : `${(score.durationMs / MILLISECONDS_PER_SECOND).toFixed(1)} s`]);
  return [header, header.map(() => "---"), ...rows].map((row) => `| ${row.join(" | ")} |`).join("\n") + "\n";
}
