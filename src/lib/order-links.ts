/**
 * Deep link to an order's view side sheet on the order list, which reads
 * `?order=` and opens the sheet (`order-list.tsx`).
 */

export const ORDER_DEEP_LINK_PARAM = "order";

export function orderDeepLinkHref(orderId: string, facilityId?: string): string {
  const params = new URLSearchParams();
  if (facilityId) params.set("facility", facilityId);
  params.set(ORDER_DEEP_LINK_PARAM, orderId);
  return `/orders?${params.toString()}`;
}
