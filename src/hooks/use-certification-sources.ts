/**
 * Phase 3.5 — Isometric Sources hooks.
 *
 * Mirrors noma `documents` rows to Isometric Sources via server-side proxy.
 * Resulting `source_ids` ride into Datapoint payloads at submit time and
 * are part of the semantic hash, so a sources change forces a new Removal
 * version.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import {
  loadCandidateDocumentsForRemoval,
  mirrorDocumentToSource,
  unlinkDocumentSource,
  type CandidateDocumentsForRemoval,
  type MirrorResult,
} from "@/fn/certification";
import type {
  MirrorDocumentToSourceInput,
  UnlinkDocumentSourceInput,
} from "@/schemas/certification-sources";
import { certificationKeys } from "./use-certification";

const SOURCES_STALE_MS = 30_000;

export const certificationSourcesKeys = {
  candidatesForRemoval: (removalId: string) =>
    [...certificationKeys.all, "sources", "candidates", removalId] as const,
};

export function applyConfirmedSourceMapping(
  current: CandidateDocumentsForRemoval | null | undefined,
  documentId: string,
  result: MirrorResult,
): CandidateDocumentsForRemoval | null | undefined {
  if (!current) return current;
  return {
    ...current,
    candidates: current.candidates.map((candidate) =>
      candidate.document.id === documentId
        ? {
            ...candidate,
            mirror: {
              externalDocumentId: result.externalDocumentId,
              isPublic: result.isPublic,
              mirroredAt: new Date(),
            },
          }
        : candidate,
    ),
    mirroredExternalIds: Array.from(
      new Set([...current.mirroredExternalIds, result.externalDocumentId]),
    ).sort(),
  };
}

export async function reconcileCandidateSourcesAfterFailure(
  queryClient: QueryClient,
  removalId: string,
): Promise<void> {
  try {
    await queryClient.refetchQueries({
      queryKey: certificationSourcesKeys.candidatesForRemoval(removalId),
      type: "active",
    });
  } catch {
    // A failed reconciliation is still settled. Preserve the original mirror
    // error and expose Retry only after this read attempt has completed.
  }
}

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
