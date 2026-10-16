const TERMINAL_ATTEMPT_STATUSES = new Set(["submitted", "accepted", "rejected", "superseded"]);
const RETURNED_STATEMENT_STATUSES = new Set(["FAILED_VERIFICATION", "DRAFT"]);

/** Client-safe facts. Callers resolve dependencies and every ledger version. */
export interface RecordLockHolder {
  kind: string;
  id: string;
  label?: string;
}

export interface RecordLockSubmission {
  status: string;
  inFlight?: boolean;
  hasRemoteMutation?: boolean;
}

export interface RecordLockStatement {
  id: string;
  status: string | null;
  fresh: boolean;
  submittedToVerifier: boolean;
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
  /** Proposed non-numeric fields. Saving these while In use ships in #1120. */
  freeFields: readonly string[];
  howToFree: string | null;
}

export function isSentRemoval(removal: RecordLockRemoval): boolean {
  const unknownOrInFlight = removal.submissions.some(submission =>
    submission.inFlight || !TERMINAL_ATTEMPT_STATUSES.has(submission.status),
  );
  if (unknownOrInFlight) return true;
  const returned = removal.statements.some(statement => statement.fresh &&
    (statement.status === "FAILED_VERIFICATION" || (statement.status === "DRAFT" && statement.submittedToVerifier)));
  const allStatementsSafe = removal.statements.every(statement => statement.fresh && !statement.inFlight &&
    RETURNED_STATEMENT_STATUSES.has(statement.status ?? ""));
  if (returned && allStatementsSafe) return false;
  return removal.statements.length > 0 || removal.submissions.some(submission =>
    submission.status === "submitted" || submission.status === "accepted" || submission.hasRemoteMutation,
  );
}

function recordLock(facts: RecordLockFacts, freeFields: readonly string[]): RecordLock {
  const heldBy = [...new Set(facts.removals.filter(isSentRemoval).map(removal => removal.id))].map(id => ({ kind: "removal", id }));
  if (heldBy.length) return { level: "sent", heldBy, freeFields: [], howToFree: "Wait for Isometric to return the covering GHG Statement, then refresh its status." };
  if (facts.dependents.length) return { level: "inUse", heldBy: facts.dependents, freeFields,
    howToFree: "Correct or remove the records that use it first." };
  return { level: "open", heldBy: [], freeFields, howToFree: null };
}

export const recordLocks = {
  feedstock: (facts: RecordLockFacts) => recordLock(facts, ["code", "notes"]),
  productionRun: (facts: RecordLockFacts) => recordLock(facts, ["code"]),
  sample: (facts: RecordLockFacts) => recordLock(facts, ["sampleCode"]),
  biocharProduct: (facts: RecordLockFacts) => recordLock(facts, ["code"]),
  order: (facts: RecordLockFacts) => recordLock(facts, ["code"]),
  delivery: (facts: RecordLockFacts) => recordLock(facts, ["code"]),
  application: (facts: RecordLockFacts) => recordLock(facts, ["code"]),
  creditBatch: (facts: RecordLockFacts) => recordLock(facts, ["code", "siteManagementNotes"]),
  removal: (facts: RecordLockFacts) => recordLock(facts, []),
  stockEntry: (facts: RecordLockFacts) => recordLock(facts, ["reason"]),
  storageLocation: (facts: RecordLockFacts) => recordLock(facts, ["code", "name"]),
} as const;

export type RecordLockKind = keyof typeof recordLocks;

/** Every lock refusal names its holder, then explains how to free the record. */
export function withRecordLockGuidance(message: string, lock: RecordLock): string {
  return lock.howToFree ? `${message} ${lock.howToFree}` : message;
}
