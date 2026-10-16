import type { RecordLock } from "./record-lock";

/** Record kinds a screen can ask about: every lineage kind plus storage bins. */
export const RECORD_LOCK_VIEW_KINDS = [
  "feedstock", "productionRun", "sample", "biocharProduct", "order", "delivery",
  "application", "creditBatch", "storageLocation",
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
  count?: number;
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
}

export type RecordLockViews = Record<string, RecordLockView>;

/**
 * A field the server refuses today: every field once Sent, and every field
 * outside `freeFields` while In use. An unknown lock (still loading, failed)
 * leaves the field to the server, which decides.
 */
export function isRecordFieldLocked(view: RecordLockView | null | undefined, field: string): boolean {
  if (!view || view.level === "open") return false;
  return view.level === "sent" || !view.freeFields.includes(field);
}

/** Edit stays useful only while something is still free. */
export function isRecordEditable(view: RecordLockView | null | undefined): boolean {
  return view?.level !== "sent";
}

/** Delete is only ever accepted while nothing uses the record and it was never sent. */
export function isRecordDeletable(view: RecordLockView | null | undefined): boolean {
  return !view || view.level === "open";
}
