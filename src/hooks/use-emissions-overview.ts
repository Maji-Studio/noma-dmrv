/**
 * Emissions overview read: every credit batch of a facility with its emission
 * line counts (epic #1058).
 */
import { useQuery } from "@tanstack/react-query";
import { getFacilityEmissionsOverviewFn } from "@/fn/emission-entries";
import { creditBatchKeys } from "@/hooks/credit-batch-query-keys";
import { unwrap } from "@/hooks/types";
import type { FacilityEmissionsOverview } from "@/lib/read-models/facility-emissions-overview";

export type { FacilityEmissionsOverview };
export type FacilityEmissionsOverviewBatch = FacilityEmissionsOverview["batches"][number];
export type EmissionLineCounts = FacilityEmissionsOverviewBatch["lineCounts"];

export function useEmissionsOverview(facilityId: string | null | undefined) {
  return useQuery({
    queryKey: creditBatchKeys.emissionsOverview(facilityId ?? ""),
    queryFn: async () => unwrap(await getFacilityEmissionsOverviewFn({ facilityId: facilityId! })),
    enabled: !!facilityId,
    // Line states move whenever runs, legs, deliveries, applications or
    // manual entries change elsewhere; refetch on each visit.
    staleTime: 0,
  });
}
