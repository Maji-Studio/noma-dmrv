import { formatUtcDate } from "@/lib/date-utils";
import type { RecordLockView } from "@/lib/record-lock-view";
import type { CreditBatchFormData } from "@/schemas/credit-batches";

/** Saved fields the membership guard compares against. */
export interface SavedCreditBatchDefinition {
  facilityId: string;
  feedstockTypeId: string | null;
  startDate: string;
  endDate: string;
  productionRunIds?: readonly string[];
}

const MEMBERSHIP_FIELDS = ["facilityId", "feedstockTypeId", "startDate", "endDate", "productionRunIds"] as const;

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

/**
 * The update payload with every unchanged membership field left out, so a
 * notes-only save never asks the server to refresh membership. While the
 * membership is locked it is always left out.
 */
export function creditBatchUpdatePatch(
  data: Omit<CreditBatchFormData, "sampling">,
  saved: SavedCreditBatchDefinition,
  membershipLocked: boolean,
): Partial<Omit<CreditBatchFormData, "sampling">> {
  const unchanged = {
    facilityId: data.facilityId === saved.facilityId,
    feedstockTypeId: data.feedstockTypeId === (saved.feedstockTypeId ?? ""),
    startDate: sameDay(data.startDate, saved.startDate),
    endDate: sameDay(data.endDate, saved.endDate),
    productionRunIds: sameRuns(data.productionRunIds, saved.productionRunIds),
  };
  const patch: Partial<Omit<CreditBatchFormData, "sampling">> = { ...data };
  for (const field of MEMBERSHIP_FIELDS) {
    if (membershipLocked || unchanged[field]) delete patch[field];
  }
  return patch;
}
