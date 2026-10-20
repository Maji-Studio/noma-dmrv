import { throwActionError } from "@/lib/stale-version";
import { patchArrayListCachesByPrefixWithSavedRow } from "./list-cache-utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { loadRemovalTemplateReviewEntry, loadRemovalTemplateReviewPreview, loadRemovalTemplateReview, reviewRemovalTemplateLines, switchCreditBatchRemovalTemplate } from "@/fn/certification/removal-template-review";
import type { ReviewRemovalTemplateLinesInput, SwitchCreditBatchRemovalTemplateInput } from "@/schemas/removal-template-review";
import { unwrap } from "./types";
import { certificationKeys } from "./use-certification";
import { creditBatchKeys } from "./credit-batch-query-keys";
import { activityKeys } from "./activity-query-keys";
import { setFacilityDefaultRemovalTemplate, startRemovalTemplateSetup } from "@/fn/certification/removal-template-setup";
import type { SetFacilityDefaultRemovalTemplateInput, StartRemovalTemplateSetupInput } from "@/schemas/removal-template-setup";
import { invalidateOnboardingProgress } from "./use-onboarding";

const REVIEW_STALE_MS = 60_000;

export function useSetFacilityDefaultRemovalTemplate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: SetFacilityDefaultRemovalTemplateInput) => unwrap(await setFacilityDefaultRemovalTemplate(input)),
    onSuccess: async (_data, input) => {
      invalidateOnboardingProgress(client, input.facilityId);
      await Promise.all([
        client.invalidateQueries({ queryKey: certificationKeys.all }),
        client.invalidateQueries({ queryKey: creditBatchKeys.all }),
        client.invalidateQueries({ queryKey: activityKeys.all }),
      ]);
    },
  });
}

export function useStartRemovalTemplateSetup() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: StartRemovalTemplateSetupInput) => unwrap(await startRemovalTemplateSetup(input)),
    onSuccess: () => client.invalidateQueries({ queryKey: certificationKeys.all }),
  });
}
/**
 * `fresh` reads again whenever the window regains focus: the batch dialog
 * sends "Decide lines" to a new tab and must see those decisions on return.
 */
export function useRemovalTemplateReview(facilityId: string, enabled = true, { fresh = false } = {}) {
  return useQuery({
    queryKey: certificationKeys.removalTemplateReview(facilityId),
    queryFn: async () => unwrap(await loadRemovalTemplateReview(facilityId)),
    enabled: enabled && !!facilityId,
    staleTime: fresh ? 0 : REVIEW_STALE_MS,
    refetchOnWindowFocus: fresh,
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

/** One listed template's lines for review, read without observing it. */
export function useRemovalTemplateReviewEntry(facilityId: string, removalTemplateId: string, enabled = true) {
  return useQuery({
    queryKey: certificationKeys.removalTemplateReviewEntry(facilityId, removalTemplateId),
    queryFn: async () => unwrap(await loadRemovalTemplateReviewEntry({ facilityId, removalTemplateId })),
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
      void client.invalidateQueries({ queryKey: activityKeys.all });
      patchArrayListCachesByPrefixWithSavedRow(client, creditBatchKeys.lists(), batch);
      client.setQueryData(creditBatchKeys.detail(batch.id), (old: object | undefined) => old ? { ...old, ...batch } : old);
      await Promise.all([
        client.invalidateQueries({ queryKey: certificationKeys.all }),
        client.invalidateQueries({ queryKey: creditBatchKeys.all }),
      ]);
    },
  });
}
