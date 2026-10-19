"use client";

import { outputMoistureFieldEstimate, type MoistureFieldEstimate } from "@/lib/output-stock/moisture-guidance";
import type { OutputMoistureEstimate } from "@/types/output-stock";
import { useFacilityClock } from "./use-facility-context";
import { useOutputStockBalance } from "./use-output-stock";

/**
 * The estimate a stock moisture field is checked against: the bin's moisture
 * from each batch's last count, or its recorded moisture, at the entry's time. Null until a bin is
 * chosen or when the bin has no estimate. A live preview's own estimate wins
 * (`fromPreview`): it is computed for the same entry, including a correction's
 * stock before the entry it replaces.
 */
export function useOutputMoistureEstimate(storageLocationId: string | null | undefined, facilityId: string | null | undefined, occurredAt: string | null | undefined, fromPreview?: OutputMoistureEstimate | null): MoistureFieldEstimate | null {
  const clock = useFacilityClock(facilityId ?? "");
  const validTime = typeof occurredAt === "string" && !Number.isNaN(Date.parse(occurredAt)) ? new Date(occurredAt).toISOString() : undefined;
  const balance = useOutputStockBalance(storageLocationId && facilityId ? { storageLocationId, facilityId } : null, validTime);
  return outputMoistureFieldEstimate(fromPreview ?? balance.data?.moistureEstimate, clock.timeZone);
}
