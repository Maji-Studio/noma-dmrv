/**
 * Deep link to a GHG Statement on the GHG Statements list, which reads
 * `?statement=` and opens its read-only modal (`ghg-statements-list.tsx`).
 */

export const GHG_STATEMENT_DEEP_LINK_PARAM = "statement";

export function ghgStatementDeepLinkHref(ghgStatementId: string, facilityId?: string): string {
  const params = new URLSearchParams();
  if (facilityId) params.set("facility", facilityId);
  params.set(GHG_STATEMENT_DEEP_LINK_PARAM, ghgStatementId);
  return `/certification/ghg-statements?${params.toString()}`;
}
