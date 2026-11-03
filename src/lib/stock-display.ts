import { STOCK_DISPLAY_MIN_KG } from "@/config/output-stock";

/** Label an empty bin carries wherever its stock is shown. */
export const EMPTY_STOCK_LABEL = "Empty";

/**
 * The mass a bin is judged by: its wet mass, the figure operators find on
 * site, or the dry biochar when no wet figure exists. Null while unknown.
 */
export function stockBasisKg(wetKg: number | null | undefined, dryKg: number | null | undefined): number | null {
  return wetKg ?? dryKg ?? null;
}

/**
 * Whether a known stock is too small to show: nothing, or a residue under the
 * display minimum. A negative stock is not empty: it is the reconcile signal.
 */
export function isStockBelowDisplay(kg: number | null | undefined): boolean {
  return kg != null && kg >= 0 && kg < STOCK_DISPLAY_MIN_KG;
}
