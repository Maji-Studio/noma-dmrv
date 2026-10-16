/**
 * Energy page read (ADR 0031).
 */
import { useQuery } from "@tanstack/react-query";
import { getEnergyBreakdown } from "@/fn/energy";
import { unwrap } from "@/hooks/types";
import type { EnergyBreakdownInput } from "@/schemas/energy";

export const energyKeys = {
  all: ["energy"] as const,
  breakdowns: () => [...energyKeys.all, "breakdown"] as const,
  breakdown: (input: EnergyBreakdownInput) =>
    [...energyKeys.breakdowns(), input.facilityId, input.from, input.to] as const,
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
