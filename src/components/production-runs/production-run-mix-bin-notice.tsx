/**
 * Rule 19 on the production-run form: a run completed into a mix biochar bin
 * at a time before saved mix removals adds to a pile those removals were
 * calculated without. Their saved shares stay; the operator is told which.
 */
"use client";

import { StockNotice } from "@/components/storage-locations/stock-figures";
import { useOutputStockBalance } from "@/hooks/use-output-stock";
import { combineDateAndTime, formatLocalDate } from "@/lib/date-utils";
import { backdatedNotice } from "@/lib/output-stock/messages";

/** The run's end as an instant, or null while the date or time is incomplete. */
function runEndInstant(endDate: unknown, endTime: unknown, timeZone: string): string | null {
  const dateStr = typeof endDate === "string" ? endDate : endDate instanceof Date ? formatLocalDate(endDate) : null;
  if (!dateStr || typeof endTime !== "string" || !endTime) return null;
  try {
    const instant = combineDateAndTime(dateStr, endTime, timeZone);
    return Number.isNaN(instant.getTime()) ? null : instant.toISOString();
  } catch {
    return null;
  }
}

export function ProductionRunMixBinNotice({ binId, facilityId, endDate, endTime, timeZone, complete }: {
  binId: string | null | undefined;
  facilityId: string | null | undefined;
  endDate: unknown;
  endTime: unknown;
  timeZone: string;
  /** A run completing now, or one whose end or bin changed: only then is its biochar a new entry in the bin. */
  complete: boolean;
}) {
  const at = complete ? runEndInstant(endDate, endTime, timeZone) : null;
  const bin = binId && facilityId && at ? { storageLocationId: binId, facilityId } : null;
  const balance = useOutputStockBalance(bin, at ?? undefined);
  const notice = balance.data ? backdatedNotice(balance.data) : null;
  return notice ? <StockNotice>{notice}</StockNotice> : null;
}
