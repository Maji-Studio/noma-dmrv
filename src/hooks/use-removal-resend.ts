"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { checkRemovalRegistryPresence, prepareRemovalResend } from "@/fn/certification/removal-resend";
import { unwrap } from "@/hooks/types";
import { certificationKeys } from "./certification-query-keys";
import { invalidateCertificationReadiness } from "./stale-reads";

/**
 * Whether Isometric still has the sent Removal. One read per sheet open: it asks the registry, so
 * it is neither refetched on focus nor retried, and a failed read stays silent (the notice only
 * shows for a confirmed "missing").
 */
export function useRemovalRegistryPresence(facilityId: string, removalId: string, enabled: boolean) {
  return useQuery({
    queryKey: certificationKeys.removalRegistryPresence(facilityId, removalId),
    queryFn: async () => unwrap(await checkRemovalRegistryPresence({ facilityId, removalId })),
    enabled: enabled && !!facilityId && !!removalId,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/** Retires the missing version so the normal review and submit can send the next one. Records stay locked. */
export function usePrepareRemovalResend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { facilityId: string; removalId: string }) => unwrap(await prepareRemovalResend(input)),
    // A refusal that says the Removal is still in Isometric must also clear the notice that offered the action.
    onError: (_error, input) => queryClient.invalidateQueries({ queryKey: certificationKeys.removalRegistryPresence(input.facilityId, input.removalId) }),
    onSuccess: async (_data, input) => {
      await Promise.all([
        invalidateCertificationReadiness(queryClient),
        queryClient.invalidateQueries({ queryKey: certificationKeys.removalCompilation(input.facilityId, input.removalId) }),
      ]);
    },
  });
}
