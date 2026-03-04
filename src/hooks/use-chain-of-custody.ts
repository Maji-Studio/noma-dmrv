/**
 * Chain of Custody React Query Hook
 */

import { useQuery } from "@tanstack/react-query";
import { getChainOfCustodyFn } from "@/fn/chain-of-custody";

export const chainOfCustodyKeys = {
  all: ["chain-of-custody"] as const,
  detail: (facilityId: string) => [...chainOfCustodyKeys.all, facilityId] as const,
};

export function useChainOfCustody(facilityId: string | null) {
  return useQuery({
    queryKey: chainOfCustodyKeys.detail(facilityId ?? ""),
    queryFn: async () => {
      const result = await getChainOfCustodyFn(facilityId!);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: !!facilityId,
    staleTime: 30000,
  });
}
