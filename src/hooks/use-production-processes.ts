/**
 * Production Processes React Query hooks (read-only, ADR 0017 Track 1.5).
 *
 * A production process is the (facility, feedstock) sampling-regime campaign
 * that scopes Method A/B. This surface is read-only today; the Method-B unlock
 * mutation ships with Track 2.
 */

import { useQuery } from "@tanstack/react-query";
import type { ProductionProcessSummary } from "@/data-access/production-processes";
import { getProductionProcessSummariesByFacilityFn } from "@/fn/production-processes";

export const productionProcessKeys = {
  all: ["production-processes"] as const,
  byFacility: (facilityId: string) =>
    [...productionProcessKeys.all, "byFacility", facilityId] as const,
};

/**
 * Fetch a facility's production-process summaries (sampling method, Method-B
 * baseline progress, cadence status).
 */
export function useProductionProcessesByFacility(
  facilityId: string | null | undefined,
  enabled = true,
) {
  return useQuery<ProductionProcessSummary[]>({
    queryKey: productionProcessKeys.byFacility(facilityId ?? ""),
    queryFn: async () => {
      const result = await getProductionProcessSummariesByFacilityFn(
        facilityId as string,
      );
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: enabled && !!facilityId,
    staleTime: 30000,
  });
}
