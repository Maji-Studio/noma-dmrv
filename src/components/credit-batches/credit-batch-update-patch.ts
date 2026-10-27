import { isActionError } from "@/lib/action-error";
import type { RecordLockView } from "@/lib/record-lock-view";
import type { CreditBatchFormData, UpdateCreditBatchData } from "@/schemas/credit-batches";

import { creditBatchOnlyAddsRuns, unchangedDay, type CreditBatchMembershipDefinition } from "@/lib/credit-batch-membership-change";

export { creditBatchOnlyAddsRuns } from "@/lib/credit-batch-membership-change";

const MEMBERSHIP_FIELDS = ["facilityId", "feedstockTypeId", "startDate", "endDate", "productionRunIds"] as const;

export const CREDIT_BATCH_MEMBERSHIP_HELD_MESSAGE =
  "A Removal now holds this credit batch, so its feedstock type, dates and current production runs cannot change. Restore them or cancel the edit.";

/** A held batch cannot change its cohort definition or remove runs. */
export function isCreditBatchMembershipLocked(lock: RecordLockView | undefined): boolean {
  return !!lock && (lock.level === "sent" || lock.usedBy.some((link) => link.kind === "removal"));
}

/**
 * Free, draft and returned batches accept additions; Sent batches do not.
 * Undefined also returns true; the form separately requires a loaded lock
 * (`!!lock`) before offering held additions.
 */
export function canAddCreditBatchRuns(lock: RecordLockView | undefined): boolean {
  return lock?.level !== "sent";
}

function sameRuns(next: readonly string[] | undefined, saved: readonly string[] | undefined): boolean {
  if (!next) return true;
  const savedSet = new Set(saved ?? []);
  return next.length === savedSet.size && next.every((id) => savedSet.has(id));
}

/** Whether the draft moves any membership field away from the saved batch. */
export function creditBatchMembershipChanged(data: Omit<CreditBatchFormData, "sampling">, saved: CreditBatchMembershipDefinition): boolean {
  return data.facilityId !== saved.facilityId ||
    (data.feedstockTypeId ?? "") !== (saved.feedstockTypeId ?? "") ||
    !unchangedDay(data.startDate, saved.startDate) ||
    !unchangedDay(data.endDate, saved.endDate) ||
    !sameRuns(data.productionRunIds, saved.productionRunIds);
}

/** A held batch sends only added runs and non-membership fields. */
export function creditBatchUpdatePatch(
  data: Omit<CreditBatchFormData, "sampling">,
  saved: CreditBatchMembershipDefinition,
  lock: RecordLockView | undefined,
): Partial<Omit<CreditBatchFormData, "sampling">> | null {
  if (!isCreditBatchMembershipLocked(lock)) return data;
  const onlyAdds = canAddCreditBatchRuns(lock) && creditBatchOnlyAddsRuns(data, saved);
  if (creditBatchMembershipChanged(data, saved) && !onlyAdds) return null;
  const patch: Partial<Omit<CreditBatchFormData, "sampling">> = { ...data };
  for (const field of MEMBERSHIP_FIELDS) delete patch[field];
  if (onlyAdds) patch.productionRunIds = data.productionRunIds;
  return patch;
}

const NOT_SAVED_MESSAGE = "Credit batch was not saved. Try again.";

/**
 * Logs a save failure unless it is a refusal. A refused action (dates outside
 * the entries, a stale version) is an expected answer shown beside the form, so
 * it must not light the dev error badge; anything else is a real failure.
 */
export function logUnexpectedSaveError(label: string, err: unknown) {
  if (!isActionError(err)) console.error(label, err);
}

/** What one edit save came to: saved (maybe with a warning), or the error to show beside the form. */
export type CreditBatchSaveOutcome =
  | { status: "saved"; warning?: string }
  | {
      status: "error";
      message: string;
      /** The thrown error, so a form on the save refusal can read its issues. */
      cause?: unknown;
    };

interface SaveResult {
  success: boolean;
  error?: string;
  warning?: string;
}

/**
 * One edit save, shared by the list's sheet and the batch page. Sampling is
 * immutable and never sent; held additions follow `creditBatchUpdatePatch`.
 * `saved` is the snapshot the edit opened on, so a
 * concurrent save answers with the stale-version conflict instead of being
 * overwritten.
 */
export async function saveCreditBatchEdit({
  data,
  saved,
  lock,
  update,
}: {
  data: CreditBatchFormData;
  saved: CreditBatchMembershipDefinition & { id: string; version: number };
  lock: RecordLockView | undefined;
  update: (input: Omit<UpdateCreditBatchData, "sampling">) => Promise<SaveResult>;
}): Promise<CreditBatchSaveOutcome> {
  try {
    const { sampling, ...mutableData } = data;
    void sampling;
    const patch = creditBatchUpdatePatch(mutableData, saved, lock);
    if (!patch) return { status: "error", message: CREDIT_BATCH_MEMBERSHIP_HELD_MESSAGE };
    const result = await update({ creditBatchId: saved.id, expectedVersion: saved.version, ...patch });
    if (!result.success) return { status: "error", message: result.error || NOT_SAVED_MESSAGE };
    return result.warning ? { status: "saved", warning: result.warning } : { status: "saved" };
  } catch (err) {
    logUnexpectedSaveError("Credit batch update error:", err);
    return { status: "error", message: err instanceof Error ? err.message : NOT_SAVED_MESSAGE, cause: err };
  }
}
