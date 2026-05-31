/**
 * Phase 3.5 — Isometric Sources hooks.
 *
 * Mirrors noma `documents` rows to Isometric Sources via server-side proxy.
 * Resulting `source_ids` ride into Datapoint payloads at submit time and
 * are part of the semantic hash, so a sources change forces a new Removal
 * version.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  loadCandidateDocumentsForRemoval,
  mirrorDocumentToSource,
  setDocumentSourceVisibility,
  unlinkDocumentSource,
} from "@/fn/certification";
import type {
  MirrorDocumentToSourceInput,
  SetDocumentSourceVisibilityInput,
  UnlinkDocumentSourceInput,
} from "@/schemas/certification-sources";
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

// `removalId` is part of the action input now — the hook stamps it onto
// every variant so callers can't accidentally omit it and slip through
// the schema check.
export function useUnlinkDocumentSource(removalId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<UnlinkDocumentSourceInput, "removalId">) => {
      const result = await unlinkDocumentSource({ ...input, removalId });
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: certificationSourcesKeys.candidatesForRemoval(removalId),
      });
      queryClient.invalidateQueries({ queryKey: certificationKeys.all });
    },
  });
}

export function useSetDocumentSourceVisibility(removalId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: Omit<SetDocumentSourceVisibilityInput, "removalId">,
    ) => {
      const result = await setDocumentSourceVisibility({ ...input, removalId });
      if (!result.success) throw new Error(result.error);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: certificationSourcesKeys.candidatesForRemoval(removalId),
      });
    },
  });
}
