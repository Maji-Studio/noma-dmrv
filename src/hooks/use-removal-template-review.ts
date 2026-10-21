import { useQuery } from "@tanstack/react-query";
import { loadRemovalTemplateReviewEntry, loadRemovalTemplateReview } from "@/fn/certification/removal-template-review";
import { unwrap } from "./types";
import { certificationKeys } from "./use-certification";

const REVIEW_STALE_MS = 60_000;

/**
 * `fresh` reads again whenever the window regains focus: the batch dialog
 * sends "Decide components" to a new tab and must see those decisions on return.
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

/** One listed template's lines for review, read without observing it. */
export function useRemovalTemplateReviewEntry(facilityId: string, removalTemplateId: string, enabled = true) {
  return useQuery({
    queryKey: certificationKeys.removalTemplateReviewEntry(facilityId, removalTemplateId),
    queryFn: async () => unwrap(await loadRemovalTemplateReviewEntry({ facilityId, removalTemplateId })),
    enabled: enabled && !!facilityId && !!removalTemplateId,
    staleTime: REVIEW_STALE_MS,
  });
}
