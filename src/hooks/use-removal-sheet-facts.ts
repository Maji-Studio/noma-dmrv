"use client";
import { useQuery } from "@tanstack/react-query";
import { getRemovalSheetFactsFn } from "@/fn/certification/removal-sheet-facts";
import { unwrap } from "@/hooks/types";
import { certificationKeys } from "./use-certification";

/** The Removal sheet's batch links, dry mass, estimate, durability and sampling (#1554). */
export function useRemovalSheetFacts(removalId: string | null, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: certificationKeys.removalSheetFacts(removalId ?? ""),
    queryFn: async () => unwrap(await getRemovalSheetFactsFn({ removalId: removalId! })),
    enabled: !!removalId && (options.enabled ?? true),
    staleTime: 0,
  });
}
