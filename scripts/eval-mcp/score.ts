import { EXPECTED_DRAW_WET_MASS_KG, EXPECTED_MOISTURE_PERCENT, EXPECTED_WET_MASS_KG, MILLISECONDS_PER_SECOND, TOOL_CALL_BUDGET } from "./config";
import { formatFacilityDate } from "@/lib/date-utils";
import type { Transcript } from "./transcript";

export type CaseTwoExpectation = "ask-moisture" | "log-without-moisture";
export interface Target {
  supplierId: string;
  feedstockTypeId: string;
  facilityId: string;
  binId: string;
  today: string;
  reactorId: string;
  timeZone: string;
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
  runs: { id: string; facilityId: string; reactorId: string; status: string; startTime: string }[];
  draws: { productionRunId: string; storageLocationId: string; wetMassKg: number }[];
  audits: { transport: string; operationId: string }[];
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

function needsDrawMass(text: string): boolean {
  return text.split(/[.!\n]/).some((sentence) => /\b(?:mass|weight|how much|quantity|tonnes?|kilograms?|kg)\b/i.test(sentence)
    && /\?|\b(?:provide|enter|tell|need|needed|what|how much|specify|supply|confirm|missing|required)\b/i.test(sentence)
    && !/\b(?:no(?: longer)?|not|don't|do not)\s+(?:\w+\s+){0,2}(?:need|required)|\b(?:isn't|is not|not)\s+(?:needed|required)\b/i.test(sentence));
}

export function scoreCase(
  caseId: string, expectation: CaseTwoExpectation, target: Target,
  snapshot: DatabaseSnapshot, transcript: Transcript,
): CaseScore {
  const chained = caseId === "chained-mass-omitted" || caseId === "chained-complete";
  const completeRun = caseId === "chained-complete";
  const expectedDraw = completeRun ? EXPECTED_DRAW_WET_MASS_KG : 0;
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
      moisture: caseId !== "missing-moisture" ? row?.moistureContentPercent === EXPECTED_MOISTURE_PERCENT
        : row?.moistureContentPercent == null && !!row,
      date: row?.deliveryDate === target.today,
      bins: row?.storageLocationId === target.binId && snapshot.bins.some((bin) => bin.id === target.binId)
        && snapshot.bins.every((bin) => bin.afterWetKg - bin.beforeWetKg === (bin.id === target.binId ? EXPECTED_WET_MASS_KG - expectedDraw : 0)),
      audit: snapshot.audits.every((audit) => audit.transport === "mcp")
        && snapshot.audits.filter((audit) => audit.operationId === "log_feedstock_delivery").length === 1
        && snapshot.audits.length === 1 + (chained ? snapshot.runs.length : 0),
    });
  }
  if (chained) {
    const run = snapshot.runs[0];
    const validRun = snapshot.runs.length === 1 && run.facilityId === target.facilityId
      && run.reactorId === target.reactorId && run.status === "running";
    if (completeRun) {
      Object.assign(criteria, {
        run: validRun,
        startDate: !!run && Number.isFinite(Date.parse(run.startTime))
          && formatFacilityDate(new Date(run.startTime), target.timeZone) === target.today,
        draw: snapshot.draws.length === 1 && snapshot.draws[0].productionRunId === run?.id
          && snapshot.draws[0].storageLocationId === target.binId && snapshot.draws[0].wetMassKg === EXPECTED_DRAW_WET_MASS_KG,
      });
    } else {
      Object.assign(criteria, {
        run: snapshot.runs.length === 0 || validRun,
        noInventedDraw: snapshot.draws.length === 0,
        needsDrawMass: needsDrawMass(transcript.finalText),
      });
    }
    criteria.runAudit = snapshot.audits.filter((audit) => audit.operationId === "start_production_run").length === snapshot.runs.length;
  } else {
    criteria.noRun = snapshot.runs.length === 0 && snapshot.draws.length === 0;
  }
  return { caseId, expectation: chained ? completeRun ? "Start R1 drawing 1500 kg wet from B2" : "Ask for draw mass or start R1 without draws" : ask ? "Ask for moisture; save nothing" : caseId === "complete-request"
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
