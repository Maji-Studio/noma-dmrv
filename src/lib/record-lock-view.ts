import type { RecordLock } from "./record-lock";

/** Record kinds a screen can ask about: every lineage kind plus storage bins. */
export const RECORD_LOCK_VIEW_KINDS = [
  "feedstock", "productionRun", "sample", "biocharProduct", "order", "delivery",
  "application", "creditBatch", "storageLocation", "removal",
] as const;
export type RecordLockViewKind = (typeof RECORD_LOCK_VIEW_KINDS)[number];

/** Upper bound for one batched lock read: a list page, never the whole table. */
export const RECORD_LOCK_VIEW_MAX_IDS = 200;

/**
 * One record that holds or uses another, resolved for a link. `label` is the
 * record code; a Removal carries its reporting period instead, a storage bin
 * reference carries a count and has no record of its own.
 */
export interface RecordLockLink {
  kind: string;
  id: string;
  label: string | null;
  facilityId: string | null;
  period?: { startedOn: string; completedOn: string } | null;
  /** A GHG Statement known only by its reporting-period end. */
  endsOn?: string | null;
  count?: number;
}

/** Isometric returned the statement covering a sent Removal; corrections ride on its resubmission. */
export interface RecordLockReturnView {
  removal: RecordLockLink;
  statement: RecordLockLink;
  /** Certify status read fresh: FAILED_VERIFICATION, or DRAFT after verifier submission. */
  statementStatus: string | null;
}

/** What a screen needs from the predicate: the level, who holds it, who uses it. */
export interface RecordLockView {
  level: RecordLock["level"];
  /** Sent: the Removals. In use: the records that use it. */
  heldBy: RecordLockLink[];
  /** Every record that took a number from it, whatever the level. */
  usedBy: RecordLockLink[];
  freeFields: string[];
  howToFree: string | null;
  /** Open or In use after Isometric returned a sent Removal; empty otherwise. */
  returnedBy: RecordLockReturnView[];
  /** Storage bins only: the distinct formulations of the products stored in it (null is pure biochar). */
  productFormulationIds?: (string | null)[];
}

/**
 * The server refuses a product bin's formulation change while it stores a
 * product of any other formulation (`updateStorageLocation`). So the field
 * can only move to the one formulation every stored product already has.
 */
export function isBinFormulationLocked(view: RecordLockView | undefined, currentFormulationId: string | null): boolean {
  const stored = view?.productFormulationIds ?? [];
  if (stored.length === 0) return false;
  return !(stored.length === 1 && stored[0] !== currentFormulationId);
}

export type RecordLockViews = Record<string, RecordLockView>;

/**
 * A field the server refuses today: every field once Sent, and every field
 * outside `freeFields` while In use. An unknown lock leaves the field alone;
 * Save stays off until it answers (`recordLockSaveBlock`); forms use
 * `isRecordFieldHeld` to keep held fields closed meanwhile.
 */
export function isRecordFieldLocked(view: RecordLockView | null | undefined, field: string): boolean {
  if (!view || view.level === "open") return false;
  return view.level === "sent" || !view.freeFields.includes(field);
}

/** Whether a screen's lock read has answered: until then actions fail closed. */
export type RecordLockStatus = "pending" | "error" | "ready";

/** Edit is offered once the lock answered and something is still free. */
export function isRecordEditable(view: RecordLockView | null | undefined): boolean {
  return !!view && view.level !== "sent";
}

/** Delete is offered once the lock answered Open: nothing uses it and it was never sent. */
export function isRecordDeletable(view: RecordLockView | null | undefined): boolean {
  return view?.level === "open";
}

export const RECORD_LOCK_PENDING_MESSAGE = "Checking whether this record can change.";
export const RECORD_LOCK_ERROR_MESSAGE = "Couldn't check whether this record can change. Try again.";
export const RECORD_LOCK_SENT_SAVE_MESSAGE = "This record was sent with its Removal, so it cannot be saved.";
export const RECORD_LOCK_RETRY_LABEL = "Try again";

/** Why an open edit form cannot save, and whether its fields go read-only. */
export interface RecordLockSaveBlock {
  reason: string;
  tone: "info" | "error";
  readOnly: boolean;
}

/**
 * The lock's verdict on an open edit form: pending and failed reads turn
 * Save off (the held fields are already disabled); a lock that arrives Sent
 * turns the whole form read-only. The draft always stays.
 */
export function recordLockSaveBlock(view: RecordLockView | undefined, status: RecordLockStatus): RecordLockSaveBlock | null {
  if (view?.level === "sent") return { reason: RECORD_LOCK_SENT_SAVE_MESSAGE, tone: "error", readOnly: true };
  if (view) return null;
  if (status === "error") return { reason: RECORD_LOCK_ERROR_MESSAGE, tone: "error", readOnly: false };
  return status === "pending" ? { reason: RECORD_LOCK_PENDING_MESSAGE, tone: "info", readOnly: false } : null;
}

/**
 * Fields an In use record holds, for a form whose lock has not answered: the
 * kind's In use free fields stay open, everything else waits (fail closed).
 * Once the lock answers this is `isRecordFieldLocked`.
 */
export function isRecordFieldHeld(
  view: RecordLockView | undefined,
  inUseFreeFields: readonly string[],
  field: string,
): boolean {
  return view ? isRecordFieldLocked(view, field) : !inUseFreeFields.includes(field);
}

/**
 * A production run's output basis (status, times, reactor, biochar bin,
 * output mass and moisture) is refused once a product, a stock entry or a
 * count uses its stock (`assertProductionRunOutputBasisChange`), and once
 * Sent. A credit batch alone does not fix it.
 */
export function isProductionRunOutputLocked(view: RecordLockView | undefined): boolean {
  return !!view && (view.level === "sent" || view.usedBy.some((link) => link.kind !== "creditBatch"));
}
