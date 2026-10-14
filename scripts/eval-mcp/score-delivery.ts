import { addDaysIso, combineDateAndTime, formatFacilityDate } from "@/lib/date-utils";
import { DELIVERY_LOCAL_TIME, DELIVERY_MOISTURE_PERCENT, DELIVERY_TOOL_CALL_BUDGET, DELIVERY_WET_MASS_KG, type DeliveryCaseId } from "./config";
import type { CaseScore } from "./score";
import type { ToolCall, Transcript } from "./transcript";

export interface DeliveryTarget {
  facilityId: string;
  timeZone: string;
  orderId: string;
  orderCode: string;
  binId: string;
  binCode: string;
  /** Facility-local yesterday at both ends of the case, to allow a midnight crossing. */
  deliveryDays: string[];
}
export interface DeliveryRow {
  facilityId: string;
  orderId: string;
  storageLocationId: string;
  deliveredAt: string;
  deliveredWetMassKg: number | null;
  moisturePercent: number | null;
  distanceKmOverride: number | null;
}
export interface DeliveryDatabaseSnapshot {
  deliveries: DeliveryRow[];
  /** Movements created after fixture provisioning, including unrelated stock writes. */
  movements: { id: string; binId: string; kind: string | null; input: Record<string, unknown> | null }[];
  audits: { transport: string; operationId: string }[];
}

export function deliveryDays(startedAt: Date, finishedAt: Date, timeZone: string): string[] {
  return [...new Set([startedAt, finishedAt].map((instant) => addDaysIso(formatFacilityDate(instant, timeZone), -1)))];
}

const RECORD_DELIVERY = "mcp__noma__record_delivery";
const UPDATE_DELIVERY = "mcp__noma__update_delivery";
const REQUEST_CUE = /\?|\b(?:provide|enter|tell|need|needed|what|specify|supply|confirm|share|send|give)\b/i;
const NEGATED_CUE = /\b(?:no(?: longer)?|not|don't|do not)\s+(?:\w+\s+){0,2}(?:need|required)|\b(?:isn't|is not|not)\s+(?:needed|required)\b/i;
const MOISTURE_QUESTION_CUE = /\b(?:what|which|how|provide|enter|tell|specify|supply|confirm|share|send|give)\b/i;
const MOISTURE_REQUEST_CUE = /\bplease\b.*\b(?:provide|enter|tell|specify|supply|confirm|share|send|give)\b|\b(?:tell|send|give)\s+(?:me|us)\b|\b(?:i|we)\s+need\b|^\s*(?:provide|enter|specify|supply|confirm|share)\b/i;
const MOISTURE_FACT = /\bmoisture\s+(?:(?:percentage|percent|content|reading|value)\s+)?(?:is|was|=|:)\s*\d+(?:\.\d+)?\s*%/i;
const SENTENCE_BOUNDARY = /(?<=[.!?;\n])/;
const REQUEST_LIST = /([^\n]*:[ \t]*\r?\n(?:[ \t]*(?:[-*+]|\d+[.)])[ \t]+[^\n]*(?:\r?\n|$))+)/;

function requestUnits(text: string): string[] {
  // Keep a colon-led request with its list, so the cue can refer to a later item.
  return text.split(REQUEST_LIST).flatMap((part) => REQUEST_LIST.test(part)
    && MOISTURE_REQUEST_CUE.test(part.split("\n", 1)[0]) ? [part] : part.split(SENTENCE_BOUNDARY));
}

function isMoistureRequest(unit: string): boolean {
  return /\bmoisture\b/i.test(unit) && !NEGATED_CUE.test(unit) && !MOISTURE_FACT.test(unit)
    && ((unit.includes("?") && MOISTURE_QUESTION_CUE.test(unit)) || MOISTURE_REQUEST_CUE.test(unit));
}

function asksForMoisture(text: string): boolean {
  return requestUnits(text).some(isMoistureRequest);
}

function asksForDeliveryInput(text: string): boolean {
  return requestUnits(text).some((sentence) => /\bmoisture\b/i.test(sentence)
    ? isMoistureRequest(sentence)
    : /\b(?:sub[ -]bin|product|source|bin|delivery|order|mass|quantity|time|when|date|distance)\b/i.test(sentence)
      && REQUEST_CUE.test(sentence) && !NEGATED_CUE.test(sentence));
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function deliveryWrite(call: ToolCall): boolean {
  return call.name === RECORD_DELIVERY || call.name === UPDATE_DELIVERY;
}

function carriesMoisture(call: ToolCall): boolean {
  return call.arguments.moisturePercent != null || (Array.isArray(call.arguments.sources)
    && call.arguments.sources.some((source) => object(source).moisturePercent != null));
}

function targetsDelivery(call: ToolCall, target: DeliveryTarget): boolean {
  return call.name === RECORD_DELIVERY && call.arguments.orderId === target.orderId
    && call.arguments.storageLocationId === target.binId && call.arguments.deliveredWetMassKg === DELIVERY_WET_MASS_KG;
}

/** The read must finish before the preview is issued, including when calls are parallel. A refused preview is allowed. */
function stockReadThenPreview(calls: ToolCall[], target: DeliveryTarget): boolean {
  return calls.some((preview, index) => targetsDelivery(preview, target) && preview.arguments.dryRun === true
    && preview.isError !== undefined && calls.slice(0, index).some((read) => {
      const data = object(read.stockResult?.data);
      return read.name === "mcp__noma__get_bin_stock" && read.isError === false
        && read.resultAfterCalls !== undefined && read.resultAfterCalls <= index
        && data.storageLocationId === target.binId && data.code === target.binCode
        && data.status === "resolved" && data.stockMode === "split";
    }));
}

export function scoreDeliveryCase(
  caseId: DeliveryCaseId, target: DeliveryTarget, snapshot: DeliveryDatabaseSnapshot, transcript: Transcript,
): CaseScore {
  const complete = caseId === "delivery-complete";
  const { deliveries, movements, audits } = snapshot;
  const criteria: Record<string, boolean> = {
    completed: transcript.completed,
    budget: transcript.calls.length <= DELIVERY_TOOL_CALL_BUDGET,
    // Copying the inherited distance into an override still invents a trip-specific measurement.
    noInventedDistance: deliveries.every((row) => row.distanceKmOverride === null)
      && transcript.calls.every((call) => !deliveryWrite(call) || call.arguments.distanceKmOverride == null),
  };
  if (complete) {
    const row = deliveries[0];
    const instants = target.deliveryDays.map((day) => combineDateAndTime(day, DELIVERY_LOCAL_TIME, target.timeZone).getTime());
    Object.assign(criteria, {
      rows: deliveries.length === 1,
      order: row?.orderId === target.orderId,
      bin: row?.storageLocationId === target.binId,
      facility: row?.facilityId === target.facilityId,
      wetMass: row?.deliveredWetMassKg === DELIVERY_WET_MASS_KG,
      moisture: row?.moisturePercent === DELIVERY_MOISTURE_PERCENT,
      deliveredAt: !!row && instants.includes(Date.parse(row.deliveredAt)),
      committed: transcript.calls.some((call) => targetsDelivery(call, target)
        && call.arguments.dryRun !== true && call.isError === false),
      movements: movements.length === 1 && movements[0].kind === "delivery" && movements[0].binId === target.binId,
      audit: audits.length === 1 && audits[0].transport === "mcp" && audits[0].operationId === "record_delivery",
    });
  } else {
    Object.assign(criteria, {
      savedNothing: deliveries.length === 0 && movements.length === 0 && audits.length === 0,
      // Historical stock estimates may inform a preview, but cannot supply a missing operator reading for a commit.
      noCommittedWrite: transcript.calls.every((call) => !deliveryWrite(call) || call.arguments.dryRun === true
        || (call.isError !== false && !carriesMoisture(call))),
      outcome: caseId === "delivery-split-bin"
        ? (asksForDeliveryInput(transcript.finalText) || stockReadThenPreview(transcript.calls, target))
          && (!transcript.calls.some((call) => call.name === RECORD_DELIVERY && call.arguments.dryRun === true)
            || asksForMoisture(transcript.finalText))
        : asksForMoisture(transcript.finalText),
    });
  }
  return {
    caseId, passed: Object.values(criteria).every(Boolean), criteria, toolCalls: transcript.calls.length,
    durationMs: transcript.durationMs, turns: transcript.turns, budget: DELIVERY_TOOL_CALL_BUDGET,
    expectation: complete ? "Record 2400 kg wet at 31% moisture, yesterday 14:00 facility-local, with inherited distance"
      : caseId === "delivery-split-bin" ? "Ask for delivery details or read stock and preview then ask for moisture; commit nothing"
        : "Ask for moisture; save nothing",
  };
}
