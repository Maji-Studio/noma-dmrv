/**
 * Deep link to a credit batch's view side sheet on the list page — the batch's
 * canonical URL since the standalone detail page was retired
 * (`/credit-batches/[id]` redirects here).
 */

export const CREDIT_BATCH_DEEP_LINK_PARAM = "batch";

export function creditBatchDeepLinkHref(
  creditBatchId: string,
  facilityId?: string,
): string {
  const params = new URLSearchParams();
  if (facilityId) params.set("facility", facilityId);
  params.set(CREDIT_BATCH_DEEP_LINK_PARAM, creditBatchId);
  return `/credit-batches?${params.toString()}`;
}
