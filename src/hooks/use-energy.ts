/**
 * Energy page reads and the emission-factor save (ADR 0031).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getEnergyBreakdown,
  loadFacilityEmissionFactors,
  saveFacilityEmissionFactors,
} from "@/fn/energy";
import { unwrap } from "@/hooks/types";
import type { EnergyBreakdownInput } from "@/schemas/energy";
import type { SaveFacilityEmissionFactorsData } from "@/schemas/emission-factors";

export const energyKeys = {
  all: ["energy"] as const,
  breakdowns: () => [...energyKeys.all, "breakdown"] as const,
  breakdown: (input: EnergyBreakdownInput) =>
    [...energyKeys.breakdowns(), input.facilityId, input.from, input.to] as const,
  emissionFactors: (facilityId: string) =>
    [...energyKeys.all, "emission-factors", facilityId] as const,
};

export function useEnergyBreakdown(input: EnergyBreakdownInput | null) {
  return useQuery({
    queryKey: input ? energyKeys.breakdown(input) : energyKeys.breakdowns(),
    queryFn: async () => unwrap(await getEnergyBreakdown(input)),
    enabled: input != null,
    // A report over records many other screens edit (runs, feedstocks,
    // deliveries, applications, credit batches). Refetching on every visit is
    // simpler and more honest than wiring each of their mutations here.
    staleTime: 0,
    // Changing the period refetches; keep the same facility's last figures on
    // screen meanwhile, never another facility's.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === input?.facilityId ? previous : undefined,
  });
}

export function useFacilityEmissionFactors(facilityId: string | null) {
  return useQuery({
    queryKey: energyKeys.emissionFactors(facilityId ?? ""),
    queryFn: async () => unwrap(await loadFacilityEmissionFactors(facilityId ?? "")),
    enabled: !!facilityId,
  });
}

export function useSaveFacilityEmissionFactors() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveFacilityEmissionFactorsData) =>
      unwrap(await saveFacilityEmissionFactors(input)),
    onSuccess: (factors, input) => {
      queryClient.setQueryData(energyKeys.emissionFactors(input.facilityId), {
        factors,
        viewerCanManage: true,
      });
      void queryClient.invalidateQueries({ queryKey: energyKeys.breakdowns() });
    },
  });
}
