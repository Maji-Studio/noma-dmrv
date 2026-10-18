import type { UpdateFeedstockInput } from '@/data-access/feedstocks';
import type { UpdateBiocharProductInput } from '@/data-access/biochar-product-update';
import type { UpdateProductionRunData } from '@/schemas/production-runs';
import type { UpdateSampleRequest } from '@/data-access/samples/write-values';
import type { UpdateOrderInput } from '@/schemas/order-input';
import type { UpdateApplicationInput } from '@/schemas/application-input';
import type { UpdateCreditBatchData } from '@/schemas/credit-batches';
import type { UpdateStorageLocationData } from '@/schemas/storage-locations';
import type { updateDeliverySchema } from '@/schemas/deliveries';
import type { z } from 'zod';

interface RecordUpdateInputs {
  feedstock: UpdateFeedstockInput;
  productionRun: UpdateProductionRunData;
  sample: UpdateSampleRequest;
  biocharProduct: UpdateBiocharProductInput;
  order: UpdateOrderInput;
  delivery: z.output<typeof updateDeliverySchema>;
  application: UpdateApplicationInput;
  creditBatch: UpdateCreditBatchData;
  storageLocation: UpdateStorageLocationData;
  removal: Record<never, never>;
  stockEntry: Record<never, never>;
}

import type { LocalSubmissionStatus } from "@/lib/certification/status";
import { getMetadataValue } from "@/lib/certification/submission-metadata";

const TERMINAL_ATTEMPT_STATUSES: ReadonlySet<LocalSubmissionStatus> = new Set(["submitted", "accepted", "rejected", "superseded"]);
const REMOTELY_SUBMITTED_STATUSES: ReadonlySet<LocalSubmissionStatus> = new Set(["submitted", "accepted"]);

export function isTerminalAttemptStatus(status: string): boolean {
  return TERMINAL_ATTEMPT_STATUSES.has(status as LocalSubmissionStatus);
}

export function submissionHasRemoteEffect(row: { externalId?: string | null; metadata?: unknown; hasRemoteMutation?: boolean }): boolean {
  const mutation = getMetadataValue(row.metadata, "externalMutation");
  return Boolean(row.externalId || row.hasRemoteMutation) || mutation === "possible" || mutation === "confirmed";
}

export function isRemoteSubmission(submission: RecordLockSubmission): boolean {
  return REMOTELY_SUBMITTED_STATUSES.has(submission.status as LocalSubmissionStatus) || submissionHasRemoteEffect(submission);
}

export function isReturnedStatement(statement: RecordLockStatement): boolean {
  return statement.fresh && !statement.inFlight &&
    (statement.status === "FAILED_VERIFICATION" || (statement.status === "DRAFT" && statement.submittedToVerifier));
}

/** Client-safe facts. Callers resolve dependencies and every ledger version. */
export interface RecordLockHolder {
  kind: string;
  id: string;
  label?: string;
}

export interface RecordLockSubmission {
  status: string;
  id?: string;
  externalId?: string | null;
  submittedAt?: string | null;
  createdAt?: string | null;
  inFlight?: boolean;
  hasRemoteMutation?: boolean;
}

export interface RecordLockStatement {
  id: string;
  status: string | null;
  fresh: boolean;
  submittedToVerifier: boolean;
  /** Known return time or a conservative lower bound, never the refresh time. */
  returnedAt?: string | null;
  removalExternalIds?: readonly string[];
  inFlight?: boolean;
}

export interface RecordLockRemoval {
  id: string;
  label?: string;
  submissions: readonly RecordLockSubmission[];
  statements: readonly RecordLockStatement[];
}

export interface RecordLockFacts {
  dependents: readonly RecordLockHolder[];
  removals: readonly RecordLockRemoval[];
}

/** A sent Removal whose covering statements Isometric returned, so Sent was lifted. */
export interface RecordLockReturn {
  removalId: string;
  statements: readonly { id: string; status: string | null }[];
}

export interface RecordLock<Field extends string = string> {
  level: "open" | "inUse" | "sent";
  heldBy: readonly RecordLockHolder[];
  /** Fields accepted while In use, subject to ordinary validation and stock sufficiency. */
  freeFields: readonly Field[];
  howToFree: string | null;
  /** Open or In use only: the returned Removals whose resubmission will carry corrections. */
  returnedBy?: readonly RecordLockReturn[];
}

export function isSentRemoval(removal: RecordLockRemoval): boolean {
  const unknownOrInFlight = removal.submissions.some(submission =>
    submission.inFlight || !isTerminalAttemptStatus(submission.status),
  );
  if (unknownOrInFlight) return true;
  const allStatementsSafe = removal.statements.length > 0 && removal.statements.every(isReturnedStatement);
  const remoteAttempts = removal.submissions.filter(isRemoteSubmission);
  const allAttemptsReturned = remoteAttempts.every(submission => removal.statements.some(statement => {
    if (!isReturnedStatement(statement) || !submission.externalId || !statement.removalExternalIds?.includes(submission.externalId)) return false;
    // Creation may predate the remote attempt, so it cannot prove a later return.
    const attemptedAt = Date.parse(submission.submittedAt ?? "");
    const returnedAt = Date.parse(statement.returnedAt ?? "");
    return Number.isFinite(attemptedAt) && Number.isFinite(returnedAt) && attemptedAt < returnedAt;
  }));
  if (allStatementsSafe && allAttemptsReturned) return false;
  return removal.statements.length > 0 || removal.submissions.some(isRemoteSubmission);
}

/**
 * Reopened, not merely Open: the Removal reached Isometric, every covering
 * statement came back fresh, and no attempt is newer than the return (a
 * newer attempt keeps it Sent).
 */
export function isReturnedRemoval(removal: RecordLockRemoval): boolean {
  return !isSentRemoval(removal) && removal.submissions.some(isRemoteSubmission) &&
    removal.statements.length > 0 && removal.statements.every(isReturnedStatement);
}

function returnedBy(facts: RecordLockFacts): Pick<RecordLock, "returnedBy"> {
  const returned = facts.removals.filter(isReturnedRemoval).map(removal => ({
    removalId: removal.id, statements: removal.statements.map(statement => ({ id: statement.id, status: statement.status })),
  }));
  return returned.length ? { returnedBy: returned } : {};
}

function recordLock<Kind extends keyof RecordUpdateInputs>(facts: RecordLockFacts, freeFields: readonly (keyof RecordUpdateInputs[Kind] & string)[]): RecordLock<keyof RecordUpdateInputs[Kind] & string> {
  const heldBy = [...new Map(facts.removals.filter(isSentRemoval).map(removal => [removal.id, { kind: "removal", id: removal.id, ...(removal.label ? { label: removal.label } : {}) }])).values()];
  if (heldBy.length) {
    const interrupted = facts.removals.some(removal => isSentRemoval(removal) && !removal.statements.length &&
      removal.submissions.some(submission => submission.status !== "submitted" && submission.status !== "accepted"));
    return { level: "sent", heldBy, freeFields: [], howToFree: interrupted
      ? "Delete or resume the interrupted Removal, or review its records in Isometric."
      : "Wait for Isometric to return the covering GHG Statement, then refresh its status." };
  }
  if (facts.dependents.length) return { level: "inUse", heldBy: facts.dependents, freeFields,
    howToFree: "Correct or remove the records that use it first.", ...returnedBy(facts) };
  return { level: "open", heldBy: [], freeFields, howToFree: null, ...returnedBy(facts) };
}

export const recordLocks = {
  feedstock: (facts: RecordLockFacts) => recordLock<"feedstock">(facts, ["notes", "massWetKg", "moistureContentPercent", "facilityId", "deliveryDate", "supplierId", "vehicleId", "feedstockTypeId", "storageLocationId", "overrideJustification", "transportDistanceKm", "transportDistanceSource"]),
  productionRun: (facts: RecordLockFacts) => recordLock<"productionRun">(facts, ["code", "operatorId", "cancellationReason", "feedstockDraws", "feedstockMoisturePercent", "feedingRateKgHr", "residenceTimeMinutes", "dieselOperationLiters", "dieselGensetLiters", "preprocessingFuelLiters", "electricityKwh", ...(facts.dependents.every(holder => holder.kind === "creditBatch") ? ["status", "startTime", "endTime", "facilityId", "reactorId", "biocharStorageLocationId", "biocharOutputKg", "biocharMoisturePercent"] as const : [])]),
  sample: (facts: RecordLockFacts) => recordLock<"sample">(facts, ["sampleCode", "creditBatchId", "samplingTime", "totalCarbonPercent", "organicCarbonPercent",
    "labName", "labAccreditation", "analysisDate", "weightGrams", "volumeMl", "inorganicCarbonPercent", "totalHydrogenPercent", "totalNitrogenPercent",
    "totalOxygenPercent", "totalSulfurPercent", "ashContentPercent", "moistureContentPercent", "bulkDensityKgPerM3", "ph", "saltContentGPerKg",
    "oToCOrgRatio", "randomReflectanceR0Percent", "sReflectanceFraction", "r0MeasurementCount", "r0AnalysisDate", "reactiveCarbonPercent",
    "residualCarbonPercent", "tgaAnalysisDate", "phosphorusPercent", "potassiumPercent", "magnesiumPercent", "calciumPercent", "ironPercent"]),
  biocharProduct: (facts: RecordLockFacts) => recordLock<"biocharProduct">(facts, ["code", "status", "densityKgM3"]),
  order: (facts: RecordLockFacts) => recordLock<"order">(facts, ["code", "quantityKg", "orderDate", "packaging"]),
  delivery: (facts: RecordLockFacts) => recordLock<"delivery">(facts, ["code", "driverId", "vehicleId", "distanceKmOverride", "distanceSource", "distanceNote"]),
  application: (facts: RecordLockFacts) => recordLock<"application">(facts, ["code", "applicationDate", "fieldSizeHa", "fieldIdentifier", "cropType", "applicationMethod", "evidenceMethod", "gpsLatitude", "gpsLongitude", "gisBoundary", "soilTemperatureSource", "soilTemperatureC"]),
  creditBatch: (facts: RecordLockFacts) => recordLock<"creditBatch">(facts, ["code", "siteManagementNotes", ...(facts.dependents.every(holder => holder.kind === "sample") ? ["startDate", "endDate", "facilityId", "feedstockTypeId", "productionRunIds"] as const : [])]),
  removal: (facts: RecordLockFacts) => recordLock<"removal">(facts, []),
  stockEntry: (facts: RecordLockFacts) => recordLock<"stockEntry">(facts, []),
  storageLocation: (facts: RecordLockFacts) => recordLock<"storageLocation">(facts, ["code", "name", "capacityKg", "storageDescription", "storageMethod", "drawOrder", "stockMode", "mergedAt", "formulationId"]),
} as const;

export type RecordLockKind = keyof typeof recordLocks;

/** The fields a kind keeps free while In use, for forms whose lock has not answered. */
export function recordInUseFreeFields(kind: RecordLockKind): readonly string[] {
  return recordLocks[kind]({ dependents: [{ kind: "record", id: "" }], removals: [] }).freeFields;
}

/** Every lock refusal names its holder, then explains how to free the record. */
export function withRecordLockGuidance(message: string, lock: RecordLock): string {
  if (lock.level === "open") return message;
  return `${message}${formatRecordLockHolders(lock)} ${lock.howToFree ?? "Correct or remove the records that use it first."}`;
}

const HOLDER_LABELS: Record<string, string> = {
  removal: "Removal", ghgStatement: "GHG Statement", feedstock: "feedstock", productionRun: "production run",
  sample: "sample", biocharProduct: "biochar product", order: "order", delivery: "delivery",
  application: "application", creditBatch: "credit batch", stockEntry: "stock entry", storageLocation: "storage bin",
};

export function formatRecordLockHolders(lock: RecordLock): string {
  const holders = lock.heldBy.map(holder => {
    const kind = HOLDER_LABELS[holder.kind] ?? "record";
    return holder.label ? `${kind} ${holder.label}` : `${/^[aeiou]/i.test(kind) ? "an" : "a"} ${kind}`;
  });
  return holders.length ? ` Held by ${[...new Set(holders)].join(", ")}.` : "";
}
