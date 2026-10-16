import { addDaysIso, formatFacilityDate } from "@/lib/date-utils";
import { APPLICATION_TOOL_CALL_BUDGET, type ApplicationCaseId } from "./config";
import type { CaseScore } from "./score";
import type { ToolCall, Transcript } from "./transcript";

export interface ApplicationTarget {
  deliveryId: string;
  deliveryCode: string;
  remainingWetMassKg: number;
  timeZone: string;
  siteName: string;
  gpsLatitude: number;
  gpsLongitude: number;
}
export interface ApplicationRow {
  deliveryId: string;
  biocharAppliedTons: number;
  applicationDate: string;
  fieldSizeHa: number;
  fieldIdentifier: string | null;
  cropType: string | null;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
}
export interface ApplicationDatabaseSnapshot { applications: ApplicationRow[] }
const REQUESTED_TONNES = 1.2;
const REQUESTED_KG = 1200;
const FIELD_SIZE_HA = 3;
const KG_PER_TONNE = 1000;
const CAPACITY_TOLERANCE_KG = 0.001;
const RECORD = "mcp__noma__record_application";
const BALANCE = "mcp__noma__get_delivery_application_balance";
const DELETE = "mcp__noma__delete_application";
const UPDATE = "mcp__noma__update_application";
const SENTENCE_BOUNDARY = /(?<=[!?;\n])|(?<=\.)(?!\d)/;
const normalized = (value: string | null) => value?.trim().toLowerCase();
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

function capacityConflict(call: ToolCall, target: ApplicationTarget): boolean {
  const body = call.applicationResult;
  return call.name === RECORD && call.arguments.deliveryId === target.deliveryId
    && call.isError === true && body?.code === "conflict" && Array.isArray(body.issues)
    && body.issues.some((issue) => object(issue).pointer === "/appliedWetMassKg");
}

function asksForArea(text: string): boolean {
  // Keep each list item's trailing sentences together as another request unit.
  return [...text.split("\n"), ...text.split(SENTENCE_BOUNDARY)].some((unit) =>
    /\b(?:hectares?|field size|area)\b/i.test(unit)
    && /\?|\b(?:provide|tell|specify|share|supply|what|how|need|requires?|required)\b/i.test(unit)
    && !/\b(?:no need|not needed|not required|don['’]t need|do not need|doesn['’]t need)\b/i.test(unit));
}

function capacityResponse(text: string, remaining: number): boolean {
  const amounts = text.matchAll(/(?<![\w.,+-])(\d+(?:,\d{3})*(?:\.\d+)?)\s*(kg|kilograms?|t|tonnes?|tons?)\b/gi);
  return text.includes("?") || ([...amounts].some(([, value, unit]) => {
    const mass = Number(value.replaceAll(",", ""));
    const kilograms = /^(?:kg|kilograms?)$/i.test(unit) ? mass : mass * KG_PER_TONNE;
    return Math.abs(kilograms - remaining) <= CAPACITY_TOLERANCE_KG;
  }) && /\b(?:remain|remaining|left|available|enough|capacity|only)\b/i.test(text));
}

export function scoreApplicationCase(
  caseId: ApplicationCaseId, target: ApplicationTarget, snapshot: ApplicationDatabaseSnapshot,
  transcript: Transcript, now = new Date(),
): CaseScore {
  const { calls } = transcript;
  const complete = caseId === "application-complete";
  const missing = caseId === "application-missing-field-size";
  const row = snapshot.applications[0];
  // The stored timestamp is a UTC-midnight calendar date, not a facility-local instant.
  const yesterday = addDaysIso(formatFacilityDate(now, target.timeZone), -1);
  const writes = calls.filter((call) => call.name === RECORD);
  const criteria: Record<string, boolean> = {
    completed: transcript.completed,
    budget: calls.length <= APPLICATION_TOOL_CALL_BUDGET,
    noDeletes: calls.every((call) => call.name !== DELETE),
  };
  if (complete) {
    Object.assign(criteria, {
      oneApplication: snapshot.applications.length === 1,
      delivery: row?.deliveryId === target.deliveryId,
      mass: row?.biocharAppliedTons === REQUESTED_TONNES,
      date: row?.applicationDate === `${yesterday}T00:00:00.000Z`,
      field: row?.fieldSizeHa === FIELD_SIZE_HA && normalized(row?.fieldIdentifier ?? null) === "north",
      crop: normalized(row?.cropType ?? null) === "maize",
      gps: row?.gpsLatitude === target.gpsLatitude && row?.gpsLongitude === target.gpsLongitude,
      siteWarning: writes.some((call) => call.arguments.deliveryId === target.deliveryId
        && call.arguments.appliedWetMassKg === REQUESTED_KG && call.arguments.dryRun !== true && call.isError === false
        && Array.isArray(call.applicationResult?.warnings)
        && call.applicationResult.warnings.includes(`GPS copied from customer location ${target.siteName}.`)),
    });
  } else {
    criteria.noApplications = snapshot.applications.length === 0;
    if (missing) {
      criteria.asksForArea = asksForArea(transcript.finalText);
      criteria.noInventedArea = writes.every((call) => call.arguments.dryRun === true || call.arguments.fieldSizeHa == null);
    } else {
      criteria.noEdits = calls.every((call) => call.name !== UPDATE);
      criteria.balanceOrConflict = calls.some((call) =>
        (call.name === BALANCE && call.isError === false
          && [target.deliveryId, target.deliveryCode].includes(String(call.arguments.idOrCode)))
        || capacityConflict(call, target));
      criteria.capacityResponse = capacityResponse(transcript.finalText, target.remainingWetMassKg);
      criteria.noReducedCommit = writes.every((call) => call.arguments.dryRun === true || call.arguments.appliedWetMassKg === REQUESTED_KG);
    }
  }
  return { caseId, expectation: complete ? "Record one application with site defaults and facility-local yesterday"
    : missing ? "Ask for field size without committing" : "Explain insufficient capacity or ask how to proceed without committing",
  passed: Object.values(criteria).every(Boolean), criteria, toolCalls: calls.length, budget: APPLICATION_TOOL_CALL_BUDGET,
  durationMs: transcript.durationMs, turns: transcript.turns };
}
