import { isDeepStrictEqual } from "node:util";
import { addDaysIso, combineDateAndTime, formatFacilityDate } from "@/lib/date-utils";
import { deriveSampleRatios } from "@/lib/calculations/sample-ratios";
import {
  LAB_RATIO_TOLERANCE, LAB_REPLICATES, LAB_SAMPLING_LOCAL_TIME, LAB_TOOL_CALL_BUDGET, LAB_VALUE_TOLERANCE,
} from "./config";
import type { CaseScore } from "./score";
import type { Transcript } from "./transcript";

export interface LabBatchRow {
  id: string;
  code: string;
  facilityId: string;
  status: string;
  startDate: string;
  endDate: string;
  archivedAt: string | null;
}
export interface LabFacilityRow { id: string; timeZone: string; durabilityOption: string }
export interface LabSampleRow {
  creditBatchId: string | null;
  samplingTime: string;
  totalCarbonPercent: number;
  organicCarbonPercent: number;
  totalHydrogenPercent: number | null;
  totalOxygenPercent: number | null;
  ashContentPercent: number | null;
  moistureContentPercent: number | null;
  hToCOrgRatio: number | null;
}
export interface LabDatabaseSnapshot {
  samples: LabSampleRow[];
  batches: LabBatchRow[];
  facilities: LabFacilityRow[];
  /** Rows of the other workflows in the fixture organization; the fixture seeds none. */
  unrelated: { feedstocks: number; productionRuns: number; draws: number };
  audits: { transport: string; operationId: string }[];
}
export interface LabTarget {
  batch: LabBatchRow;
  facility: LabFacilityRow;
  /** Facility-local days that count as "yesterday": the run may cross local midnight. */
  sampleDays: string[];
}

/**
 * The missing-organic case asks because the published contract requires organic
 * carbon (the column is NOT NULL). If that ever changes, the case needs a new
 * expectation, so the run stops instead of scoring against a stale one.
 */
export function assertOrganicCarbonRequired(contract: Record<string, unknown>): void {
  if (!Array.isArray(contract.required) || !contract.required.includes("organicCarbonPercent")) {
    throw new Error("record_lab_sample no longer requires organic carbon. Rewrite the lab-missing-organic case.");
  }
}

/** Yesterday in the facility zone at the start and at the end of the run, deduplicated. */
export function labSampleDays(startedAt: Date, finishedAt: Date, timeZone: string): string[] {
  return [...new Set([startedAt, finishedAt].map((instant) => addDaysIso(formatFacilityDate(instant, timeZone), -1)))];
}

const REQUEST_CUE = /\?|\b(?:provide|enter|tell|need|needed|what|specify|supply|confirm|missing|required|share|send|give)\b/i;
const NEGATED_CUE = /\b(?:no(?: longer)?|not|don't|do not)\s+(?:\w+\s+){0,2}(?:need|required)|\b(?:isn't|is not|not)\s+(?:needed|required)\b/i;

function asksForOrganicCarbon(text: string): boolean {
  return text.split(/[.!\n]/).some((sentence) => /\borganic\s+carbon\b|\bC[_ ]?org\b/i.test(sentence)
    && REQUEST_CUE.test(sentence) && !NEGATED_CUE.test(sentence));
}

const close = (actual: number | null, expected: number, tolerance: number) => actual !== null && Math.abs(actual - expected) <= tolerance;

function expectedInstants(target: LabTarget): string[] {
  return target.sampleDays.map((day) => combineDateAndTime(day, LAB_SAMPLING_LOCAL_TIME, target.facility.timeZone).toISOString());
}

/** One shared instant, equal to 10:00 facility-local on an allowed day. */
function sampledAtLocalTime(samples: LabSampleRow[], target: LabTarget): boolean {
  const allowed = expectedInstants(target);
  return samples.length > 0 && samples.every((sample) => sample.samplingTime === samples[0].samplingTime && allowed.includes(sample.samplingTime));
}

function replicateValues(samples: LabSampleRow[]): { values: boolean; ratios: boolean } {
  const expected = [...LAB_REPLICATES].sort((a, b) => a.organicCarbonPercent - b.organicCarbonPercent);
  const saved = [...samples].sort((a, b) => a.organicCarbonPercent - b.organicCarbonPercent);
  if (saved.length !== expected.length) return { values: false, ratios: false };
  const pairs = expected.map((replicate, index) => ({ replicate, sample: saved[index] }));
  return {
    values: pairs.every(({ replicate, sample }) => close(sample.totalCarbonPercent, replicate.totalCarbonPercent, LAB_VALUE_TOLERANCE)
      && close(sample.organicCarbonPercent, replicate.organicCarbonPercent, LAB_VALUE_TOLERANCE)
      && close(sample.totalHydrogenPercent, replicate.hydrogenPercent, LAB_VALUE_TOLERANCE)
      && close(sample.totalOxygenPercent, replicate.oxygenPercent, LAB_VALUE_TOLERANCE)
      && close(sample.ashContentPercent, replicate.ashPercent, LAB_VALUE_TOLERANCE)
      && close(sample.moistureContentPercent, replicate.moisturePercent, LAB_VALUE_TOLERANCE)),
    // H/C_org is derived from the replicate's own hydrogen and organic carbon, never taken from the caller.
    ratios: pairs.every(({ replicate, sample }) => {
      const derived = deriveSampleRatios({
        totalHydrogenPercent: replicate.hydrogenPercent, totalOxygenPercent: replicate.oxygenPercent,
        organicCarbonPercent: replicate.organicCarbonPercent, oToCOrgRatio: null,
      }).hToCOrgRatio;
      return derived !== null && close(sample.hToCOrgRatio, derived, LAB_RATIO_TOLERANCE);
    }),
  };
}

export function scoreLabCase(
  caseId: string, target: LabTarget,
  snapshot: LabDatabaseSnapshot, transcript: Transcript,
): CaseScore {
  const complete = caseId === "lab-complete";
  const { samples, audits } = snapshot;
  const criteria: Record<string, boolean> = {
    completed: transcript.completed,
    budget: transcript.calls.length <= LAB_TOOL_CALL_BUDGET,
    // The batch and its facility are as seeded; nothing else in the organization was written.
    fixtureUnchanged: snapshot.batches.length === 1 && isDeepStrictEqual(snapshot.batches[0], target.batch)
      && snapshot.facilities.length === 1 && isDeepStrictEqual(snapshot.facilities[0], target.facility),
    noOtherRows: Object.values(snapshot.unrelated).every((count) => count === 0),
  };
  if (complete) {
    const { values, ratios } = replicateValues(samples);
    Object.assign(criteria, {
      rows: samples.length === LAB_REPLICATES.length,
      batch: samples.every((sample) => sample.creditBatchId === target.batch.id),
      samplingTime: sampledAtLocalTime(samples, target),
      values,
      hToCOrg: ratios,
      audit: audits.length === LAB_REPLICATES.length
        && audits.every((audit) => audit.transport === "mcp" && audit.operationId === "record_lab_sample"),
    });
  } else {
    Object.assign(criteria, {
      rows: samples.length === 0,
      asksOrganicCarbon: asksForOrganicCarbon(transcript.finalText),
      audit: audits.length === 0,
    });
  }
  return {
    caseId, passed: Object.values(criteria).every(Boolean), criteria, toolCalls: transcript.calls.length,
    durationMs: transcript.durationMs, turns: transcript.turns, budget: LAB_TOOL_CALL_BUDGET,
    expectation: complete ? "Record three replicates at 10:00 yesterday with derived H/C_org"
      : "Ask for organic carbon; save nothing",
  };
}
