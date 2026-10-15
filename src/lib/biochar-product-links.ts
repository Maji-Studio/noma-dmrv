/**
 * Deep link to a biochar product's view side sheet on the biochar product list, which reads
 * `?biocharProduct=` and opens the sheet (`biochar-product-list.tsx`).
 */

export const BIOCHAR_PRODUCT_DEEP_LINK_PARAM = "biocharProduct";

export function biocharProductDeepLinkHref(biocharProductId: string, facilityId?: string): string {
  const params = new URLSearchParams();
  if (facilityId) params.set("facility", facilityId);
  params.set(BIOCHAR_PRODUCT_DEEP_LINK_PARAM, biocharProductId);
  return `/biochar-products?${params.toString()}`;
}
