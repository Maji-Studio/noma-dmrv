"use client";
import { useQuery } from "@tanstack/react-query";
import { getRemovalCarriedEntriesFn } from "@/fn/certification/removal-carried-entries";
import { throwActionError } from "@/lib/stale-version";
import { certificationKeys } from "./use-certification";

export function useRemovalCarriedEntries(removalId: string | null, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: certificationKeys.removalCarriedEntries(removalId ?? ""),
    queryFn: async () => {
      const result = await getRemovalCarriedEntriesFn({ removalId: removalId! });
      if (!result.success) throwActionError(result);
      return result.data;
    },
    enabled: !!removalId && (options.enabled ?? true),
    staleTime: 0,
  });
}
