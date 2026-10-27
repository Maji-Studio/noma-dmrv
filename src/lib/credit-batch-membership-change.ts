import { formatUtcDate } from "@/lib/date-utils";

const CALENDAR_DATE_LENGTH = 10;

export interface CreditBatchMembershipDefinition {
  facilityId: string;
  feedstockTypeId: string | null;
  startDate: string;
  endDate: string;
  productionRunIds?: readonly string[];
}

type MembershipDraft = Partial<Omit<CreditBatchMembershipDefinition, "startDate" | "endDate">> & {
  startDate?: Date | string;
  endDate?: Date | string;
};

export function unchangedDay(next: Date | string | undefined, saved: string): boolean {
  return next === undefined || (next instanceof Date ? formatUtcDate(next) : next.slice(0, CALENDAR_DATE_LENGTH)) === saved;
}

/** Explicit strict superset, with omitted cohort fields preserved. Shared by UI and server. */
export function creditBatchOnlyAddsRuns(next: MembershipDraft, saved: CreditBatchMembershipDefinition): boolean {
  if (!next.productionRunIds || !saved.productionRunIds) return false;
  const requested = new Set(next.productionRunIds);
  const current = new Set(saved.productionRunIds);
  return requested.size === next.productionRunIds.length && requested.size > current.size &&
    [...current].every(id => requested.has(id)) &&
    (next.facilityId === undefined || next.facilityId === saved.facilityId) &&
    (next.feedstockTypeId === undefined || (next.feedstockTypeId ?? "") === (saved.feedstockTypeId ?? "")) &&
    unchangedDay(next.startDate, saved.startDate) && unchangedDay(next.endDate, saved.endDate);
}
