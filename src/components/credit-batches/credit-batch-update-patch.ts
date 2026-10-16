import type { RecordLockView } from "@/lib/record-lock-view";
import type { CreditBatchFormData } from "@/schemas/credit-batches";

const MEMBERSHIP_FIELDS = ["facilityId", "feedstockTypeId", "startDate", "endDate", "productionRunIds"] as const;

/**
 * The server refuses any membership refresh once a Removal holds a slice of
 * the batch (`assertCreditBatchSlicesAreUnassigned`), and a Sent Removal
 * refuses every write. A Sample alone holds no membership.
 */
export function isCreditBatchMembershipLocked(lock: RecordLockView | undefined): boolean {
  return !!lock && (lock.level === "sent" || lock.usedBy.some((link) => link.kind === "removal"));
}

/**
 * The update payload. A free batch sends its whole definition, so every save
 * re-resolves membership as before. A held batch leaves the membership out,
 * so a notes-only save passes the slice guard instead of being refused.
 */
export function creditBatchUpdatePatch(
  data: Omit<CreditBatchFormData, "sampling">,
  membershipLocked: boolean,
): Partial<Omit<CreditBatchFormData, "sampling">> {
  if (!membershipLocked) return data;
  const patch: Partial<Omit<CreditBatchFormData, "sampling">> = { ...data };
  for (const field of MEMBERSHIP_FIELDS) delete patch[field];
  return patch;
}
