"use client";
import { useQuery } from "@tanstack/react-query";
import { getRemovalCarriedEntriesFn } from "@/fn/certification/removal-carried-entries";
import { unwrap } from "@/hooks/types";
import { certificationKeys } from "./use-certification";

/** Frozen carries and live late entries for the Removal revision. */
export function useRemovalCarriedEntries(removalId: string | null, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: certificationKeys.removalCarriedEntries(removalId ?? ""),
    queryFn: async () => unwrap(await getRemovalCarriedEntriesFn({ removalId: removalId! })),
    enabled: !!removalId && (options.enabled ?? true),
    staleTime: 0,
  });
}
