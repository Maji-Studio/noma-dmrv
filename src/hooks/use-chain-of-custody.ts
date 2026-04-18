/**
 * Chain of Custody React Query Hook
 */

import { useQuery } from "@tanstack/react-query";
import { getChainOfCustodyFn } from "@/fn/chain-of-custody";

export const chainOfCustodyKeys = {
  all: ["chain-of-custody"] as const,
  detail: (applicationId: string) =>
    [...chainOfCustodyKeys.all, applicationId] as const,
};

export function useChainOfCustody(applicationId: string | null) {
  return useQuery({
    queryKey: chainOfCustodyKeys.detail(applicationId ?? ""),
    queryFn: async () => {
      const result = await getChainOfCustodyFn(applicationId!);
      if (!result.success) {
        throw new Error(result.error);
      }
      return result.data;
    },
    enabled: !!applicationId,
    staleTime: 30000,
  });
}
