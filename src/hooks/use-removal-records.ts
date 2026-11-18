"use client";
import { useQuery } from "@tanstack/react-query";
import { getRemovalRecordsFn } from "@/fn/certification/removal-records";
import { unwrap } from "@/hooks/types";
import { certificationKeys } from "./certification-query-keys";

/** The records behind a Removal, grouped by credit batch (#1554). */
export function useRemovalRecords(removalId: string | null, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: certificationKeys.removalRecords(removalId ?? ""),
    queryFn: async () => unwrap(await getRemovalRecordsFn({ removalId: removalId! })),
    enabled: !!removalId && (options.enabled ?? true),
    staleTime: 0,
  });
}
