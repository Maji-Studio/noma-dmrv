/**
 * Deep link to a delivery's view side sheet on the delivery list, which reads
 * `?delivery=` and opens the sheet (`delivery-list.tsx`).
 */

export const DELIVERY_DEEP_LINK_PARAM = "delivery";

export function deliveryDeepLinkHref(deliveryId: string, facilityId?: string): string {
  const params = new URLSearchParams();
  if (facilityId) params.set("facility", facilityId);
  params.set(DELIVERY_DEEP_LINK_PARAM, deliveryId);
  return `/deliveries?${params.toString()}`;
}
