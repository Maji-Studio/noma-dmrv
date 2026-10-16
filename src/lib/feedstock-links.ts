/**
 * Deep link to a feedstock's view side sheet on the feedstock list, which reads
 * `?feedstock=` and opens the sheet (`feedstock-list.tsx`).
 */

export const FEEDSTOCK_DEEP_LINK_PARAM = "feedstock";

export function feedstockDeepLinkHref(feedstockId: string, facilityId?: string): string {
  const params = new URLSearchParams();
  if (facilityId) params.set("facility", facilityId);
  params.set(FEEDSTOCK_DEEP_LINK_PARAM, feedstockId);
  return `/feedstocks?${params.toString()}`;
}
