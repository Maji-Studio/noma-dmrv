/**
 * Phase 3.5 — Isometric Sources hooks.
 *
 * Mirrors noma `documents` rows to Isometric Sources via server-side proxy.
 * Resulting `source_ids` ride into Datapoint payloads at submit time and
 * are part of the semantic hash. Lifecycle editability is enforced by the
 * public server action and the owning Removal surface.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  loadCandidateDocumentsForRemoval,
  mirrorDocumentToSource,
  prepareRemovalSources,
} from "@/fn/certification";
import type { MirrorDocumentToSourceInput } from "@/schemas/certification-sources";
import { certificationKeys } from "./use-certification";

const SOURCES_STALE_MS = 30_000;

export const certificationSourcesKeys = {
  candidatesForRemoval: (removalId: string) =>
    [...certificationKeys.all, "sources", "candidates", removalId] as const,
};

export function useCandidateDocumentsForRemoval(
  removalId: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: certificationSourcesKeys.candidatesForRemoval(removalId ?? ""),
    enabled: enabled && !!removalId,
    staleTime: SOURCES_STALE_MS,
    queryFn: async () => {
      if (!removalId) return null;
      const result = await loadCandidateDocumentsForRemoval({ removalId });
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
  });
}

export function useMirrorDocumentToSource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: MirrorDocumentToSourceInput) => {
      const result = await mirrorDocumentToSource(input);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({
        queryKey: certificationSourcesKeys.candidatesForRemoval(vars.removalId),
      });
      // The Sources change also shifts the removal's submit-readiness display.
      queryClient.invalidateQueries({ queryKey: certificationKeys.all });
    },
  });
}

export function usePrepareRemovalSources() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { removalId: string }) => {
      const result = await prepareRemovalSources(input);
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    // A failed all-files attempt may still have prepared some sources. Refresh
    // every dependent projection after both success and failure so a whole-flow
    // retry resumes from the persisted progress instead of showing stale counts.
    onSettled: (_data, _error, vars) => {
      queryClient.invalidateQueries({
        queryKey: certificationSourcesKeys.candidatesForRemoval(vars.removalId),
      });
      queryClient.invalidateQueries({ queryKey: certificationKeys.all });
    },
  });
}
