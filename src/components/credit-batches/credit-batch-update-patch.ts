import { formatUtcDate } from "@/lib/date-utils";
import type { RecordLockView } from "@/lib/record-lock-view";
import type { CreditBatchFormData, UpdateCreditBatchData } from "@/schemas/credit-batches";

const MEMBERSHIP_FIELDS = ["facilityId", "feedstockTypeId", "startDate", "endDate", "productionRunIds"] as const;

/** Saved fields the membership guard compares against. */
export interface SavedCreditBatchDefinition {
  facilityId: string;
  feedstockTypeId: string | null;
  startDate: string;
  endDate: string;
  productionRunIds?: readonly string[];
}

export const CREDIT_BATCH_MEMBERSHIP_HELD_MESSAGE =
  "A Removal now holds this credit batch, so its feedstock type, dates and production runs cannot change. Restore them or cancel the edit.";

/**
 * The server refuses any membership refresh once a Removal holds a slice of
 * the batch (`assertCreditBatchSlicesAreUnassigned`), and a Sent Removal
 * refuses every write. A Sample alone holds no membership.
 */
export function isCreditBatchMembershipLocked(lock: RecordLockView | undefined): boolean {
  return !!lock && (lock.level === "sent" || lock.usedBy.some((link) => link.kind === "removal"));
}

function sameDay(value: Date | string | undefined, saved: string): boolean {
  if (value == null) return true;
  return (value instanceof Date ? formatUtcDate(value) : value.slice(0, 10)) === saved;
}

function sameRuns(next: readonly string[] | undefined, saved: readonly string[] | undefined): boolean {
  if (!next) return true;
  const savedSet = new Set(saved ?? []);
  return next.length === savedSet.size && next.every((id) => savedSet.has(id));
}

/** Whether the draft moves any membership field away from the saved batch. */
export function creditBatchMembershipChanged(data: Omit<CreditBatchFormData, "sampling">, saved: SavedCreditBatchDefinition): boolean {
  return data.facilityId !== saved.facilityId ||
    data.feedstockTypeId !== (saved.feedstockTypeId ?? "") ||
    !sameDay(data.startDate, saved.startDate) ||
    !sameDay(data.endDate, saved.endDate) ||
    !sameRuns(data.productionRunIds, saved.productionRunIds);
}

/**
 * The update payload. A free batch sends its whole definition, so every save
 * re-resolves membership as before. A held batch leaves the membership out,
 * so a notes-only save passes the slice guard. A held batch whose draft
 * changed its membership (the lock arrived mid-edit) answers null: the
 * caller keeps the draft and says why instead of dropping the change.
 */
export function creditBatchUpdatePatch(
  data: Omit<CreditBatchFormData, "sampling">,
  saved: SavedCreditBatchDefinition,
  membershipLocked: boolean,
): Partial<Omit<CreditBatchFormData, "sampling">> | null {
  if (!membershipLocked) return data;
  if (creditBatchMembershipChanged(data, saved)) return null;
  const patch: Partial<Omit<CreditBatchFormData, "sampling">> = { ...data };
  for (const field of MEMBERSHIP_FIELDS) delete patch[field];
  return patch;
}

const NOT_SAVED_MESSAGE = "Credit batch was not saved. Try again.";

/** What one edit save came to: saved (maybe with a warning), or the error to show beside the form. */
export type CreditBatchSaveOutcome =
  | { status: "saved"; warning?: string }
  | { status: "error"; message: string };

interface SaveResult {
  success: boolean;
  error?: string;
  warning?: string;
}

/**
 * One edit save, shared by the list's sheet and the batch page. Sampling is
 * immutable and never sent; a held membership never reaches the server (see
 * `creditBatchUpdatePatch`); `saved` is the snapshot the edit opened on, so a
 * concurrent save answers with the stale-version conflict instead of being
 * overwritten.
 */
export async function saveCreditBatchEdit({
  data,
  saved,
  membershipLocked,
  update,
}: {
  data: CreditBatchFormData;
  saved: SavedCreditBatchDefinition & { id: string; version: number };
  membershipLocked: boolean;
  update: (input: Omit<UpdateCreditBatchData, "sampling">) => Promise<SaveResult>;
}): Promise<CreditBatchSaveOutcome> {
  try {
    const { sampling, ...mutableData } = data;
    void sampling;
    const patch = creditBatchUpdatePatch(mutableData, saved, membershipLocked);
    if (!patch) return { status: "error", message: CREDIT_BATCH_MEMBERSHIP_HELD_MESSAGE };
    const result = await update({ creditBatchId: saved.id, expectedVersion: saved.version, ...patch });
    if (!result.success) return { status: "error", message: result.error || NOT_SAVED_MESSAGE };
    return result.warning ? { status: "saved", warning: result.warning } : { status: "saved" };
  } catch (err) {
    console.error("Credit batch update error:", err);
    return { status: "error", message: err instanceof Error ? err.message : NOT_SAVED_MESSAGE };
  }
}
