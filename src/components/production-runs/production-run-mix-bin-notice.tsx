/**
 * Rule 19 on the production-run form: a run completed into a mix biochar bin
 * at a time before saved mix removals adds to a pile those removals were
 * calculated without. Their saved shares stay; the operator is told which.
 */
"use client";

import { useOutputStockBalance } from "@/hooks/use-output-stock";
import { resolveRunWindow } from "@/lib/production-runs/run-window";
import { backdatedNotice } from "@/lib/output-stock/messages";
import { Notice } from "@/components/ui/notice";

export function ProductionRunMixBinNotice({ binId, facilityId, startDate, endDate, endTime, timeZone, complete }: {
  binId: string | null | undefined;
  facilityId: string | null | undefined;
  startDate: unknown;
  endDate: unknown;
  endTime: unknown;
  timeZone: string;
  /** A run completing now, or one whose end or bin changed: only then is its biochar a new entry in the bin. */
  complete: boolean;
}) {
  const end = complete ? resolveRunWindow({ startDate, startTime: undefined, endDate, endTime }, timeZone).end : null;
  const at = end?.toISOString() ?? null;
  const bin = binId && facilityId && at ? { storageLocationId: binId, facilityId } : null;
  const balance = useOutputStockBalance(bin, at ?? undefined);
  const notice = bin && balance.data ? backdatedNotice(balance.data) : null;
  return notice ? <Notice>{notice}</Notice> : null;
}
