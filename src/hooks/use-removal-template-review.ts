import { throwActionError } from "@/lib/stale-version";
import { patchArrayListCachesByPrefixWithSavedRow } from "./list-cache-utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { loadRemovalTemplateReviewPreview, loadRemovalTemplateReview, reviewRemovalTemplateLines, switchCreditBatchRemovalTemplate } from "@/fn/certification/removal-template-review";
import type { ReviewRemovalTemplateLinesInput, SwitchCreditBatchRemovalTemplateInput } from "@/schemas/removal-template-review";
import { unwrap } from "./types";
import { certificationKeys } from "./use-certification";
import { creditBatchKeys } from "./credit-batch-query-keys";

const REVIEW_STALE_MS = 60_000;
export function useRemovalTemplateReview(facilityId: string, enabled = true) {
  return useQuery({
    queryKey: certificationKeys.removalTemplateReview(facilityId),
    queryFn: async () => unwrap(await loadRemovalTemplateReview(facilityId)),
    enabled: enabled && !!facilityId, staleTime: REVIEW_STALE_MS,
  });
}

/** Preview any selected registry template, even before it becomes a default or pin. */
export function useRemovalTemplateReviewPreview(facilityId: string, removalTemplateId: string, enabled = true) {
  return useQuery({
    queryKey: certificationKeys.removalTemplateReviewPreview(facilityId, removalTemplateId),
    queryFn: async () => unwrap(await loadRemovalTemplateReviewPreview({ facilityId, removalTemplateId })),
    enabled: enabled && !!facilityId && !!removalTemplateId,
    staleTime: REVIEW_STALE_MS,
  });
}

export function useReviewRemovalTemplateLines() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: ReviewRemovalTemplateLinesInput) => {
      const result = await reviewRemovalTemplateLines(input);
      if (!result.success) throwActionError(result);
      return result.data;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: certificationKeys.all }),
  });
}

export function useSwitchCreditBatchRemovalTemplate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: SwitchCreditBatchRemovalTemplateInput) => {
      const result = await switchCreditBatchRemovalTemplate(input);
      if (!result.success) throwActionError(result);
      return result.data;
    },
    onSuccess: async (batch) => {
      patchArrayListCachesByPrefixWithSavedRow(client, creditBatchKeys.lists(), batch);
      client.setQueryData(creditBatchKeys.detail(batch.id), (old: object | undefined) => old ? { ...old, ...batch } : old);
      await Promise.all([
        client.invalidateQueries({ queryKey: certificationKeys.all }),
        client.invalidateQueries({ queryKey: creditBatchKeys.all }),
      ]);
    },
  });
}
