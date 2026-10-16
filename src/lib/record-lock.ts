const TERMINAL_ATTEMPT_STATUSES = new Set(["submitted", "accepted", "rejected", "superseded"]);

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
  createdAt?: string;
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
  submissions: readonly RecordLockSubmission[];
  statements: readonly RecordLockStatement[];
}

export interface RecordLockFacts {
  dependents: readonly RecordLockHolder[];
  removals: readonly RecordLockRemoval[];
}

export interface RecordLock {
  level: "open" | "inUse" | "sent";
  heldBy: readonly RecordLockHolder[];
  /** Fields accepted while In use, subject to ordinary validation and stock sufficiency. */
  freeFields: readonly string[];
  howToFree: string | null;
}

export function isSentRemoval(removal: RecordLockRemoval): boolean {
  const unknownOrInFlight = removal.submissions.some(submission =>
    submission.inFlight || !TERMINAL_ATTEMPT_STATUSES.has(submission.status),
  );
  if (unknownOrInFlight) return true;
  const returned = (statement: RecordLockStatement) => statement.fresh && !statement.inFlight &&
    (statement.status === "FAILED_VERIFICATION" || (statement.status === "DRAFT" && statement.submittedToVerifier));
  const allStatementsSafe = removal.statements.length > 0 && removal.statements.every(returned);
  const remoteAttempts = removal.submissions.filter(submission =>
    submission.status === "submitted" || submission.status === "accepted" || submission.hasRemoteMutation);
  const allAttemptsReturned = remoteAttempts.every(submission => removal.statements.some(statement => {
    if (!returned(statement) || !submission.externalId || !statement.removalExternalIds?.includes(submission.externalId)) return false;
    const attemptedAt = Date.parse(submission.submittedAt ?? submission.createdAt ?? "");
    const returnedAt = Date.parse(statement.returnedAt ?? "");
    return Number.isFinite(attemptedAt) && Number.isFinite(returnedAt) && attemptedAt < returnedAt;
  }));
  if (allStatementsSafe && allAttemptsReturned) return false;
  return removal.statements.length > 0 || removal.submissions.some(submission =>
    submission.status === "submitted" || submission.status === "accepted" || submission.hasRemoteMutation,
  );
}

function recordLock(facts: RecordLockFacts, freeFields: readonly string[]): RecordLock {
  const heldBy = [...new Set(facts.removals.filter(isSentRemoval).map(removal => removal.id))].map(id => ({ kind: "removal", id }));
  if (heldBy.length) {
    const interrupted = facts.removals.some(removal => isSentRemoval(removal) && !removal.statements.length &&
      removal.submissions.some(submission => submission.status !== "submitted" && submission.status !== "accepted"));
    return { level: "sent", heldBy, freeFields: [], howToFree: interrupted
      ? "Delete or resume the interrupted Removal, or review its records in Isometric."
      : "Wait for Isometric to return the covering GHG Statement, then refresh its status." };
  }
  if (facts.dependents.length) return { level: "inUse", heldBy: facts.dependents, freeFields,
    howToFree: "Correct or remove the records that use it first." };
  return { level: "open", heldBy: [], freeFields, howToFree: null };
}

export const recordLocks = {
  feedstock: (facts: RecordLockFacts) => recordLock(facts, ["notes", "massWetKg", "moistureContentPercent", "facilityId", "deliveryDate", "supplierId", "vehicleId", "feedstockTypeId", "storageLocationId", "overrideJustification", "transportDistanceKm", "transportDistanceSource"]),
  productionRun: (facts: RecordLockFacts) => recordLock(facts, ["code", "operatorId", "cancellationReason", "feedstockDraws", "feedstockMoisturePercent", "feedingRateKgHr", "residenceTimeMinutes", "dieselOperationLiters", "dieselGensetLiters", "preprocessingFuelLiters", "electricityKwh"]),
  sample: (facts: RecordLockFacts) => recordLock(facts, ["sampleCode", "creditBatchId", "samplingTime", "totalCarbonPercent", "organicCarbonPercent",
    "labName", "labAccreditation", "analysisDate", "weightGrams", "volumeMl", "inorganicCarbonPercent", "totalHydrogenPercent", "totalNitrogenPercent",
    "totalOxygenPercent", "totalSulfurPercent", "ashContentPercent", "moistureContentPercent", "bulkDensityKgPerM3", "ph", "saltContentGPerKg",
    "oToCOrgRatio", "randomReflectanceR0Percent", "sReflectanceFraction", "r0MeasurementCount", "r0AnalysisDate", "reactiveCarbonPercent",
    "residualCarbonPercent", "tgaAnalysisDate", "phosphorusPercent", "potassiumPercent", "magnesiumPercent", "calciumPercent", "ironPercent"]),
  biocharProduct: (facts: RecordLockFacts) => recordLock(facts, ["code", "status", "densityKgM3"]),
  order: (facts: RecordLockFacts) => recordLock(facts, ["code", "quantityKg", "orderDate", "packaging"]),
  delivery: (facts: RecordLockFacts) => recordLock(facts, ["code", "driverId", "vehicleId", "distanceKmOverride", "distanceSource", "distanceNote"]),
  application: (facts: RecordLockFacts) => recordLock(facts, ["code", "applicationDate", "fieldSizeHa", "fieldIdentifier", "cropType", "applicationMethod", "evidenceMethod", "gpsLatitude", "gpsLongitude", "gisBoundary", "soilTemperatureSource", "soilTemperatureC"]),
  creditBatch: (facts: RecordLockFacts) => recordLock(facts, ["code", "siteManagementNotes"]),
  removal: (facts: RecordLockFacts) => recordLock(facts, []),
  stockEntry: (facts: RecordLockFacts) => recordLock(facts, []),
  storageLocation: (facts: RecordLockFacts) => recordLock(facts, ["code", "name", "capacityKg", "storageDescription", "storageMethod", "drawOrder"]),
} as const;

export type RecordLockKind = keyof typeof recordLocks;

/** Every lock refusal names its holder, then explains how to free the record. */
export function withRecordLockGuidance(message: string, lock: RecordLock): string {
  return lock.howToFree ? `${message} ${lock.howToFree}` : message;
}
