import { WET_ESTIMATE_DISPLAY_MIN_KG } from "@/config/output-stock";
import { massKgRoundsToZero } from "@/lib/format-utils";

/** Label an empty bin carries wherever its stock is shown. */
export const EMPTY_STOCK_LABEL = "Empty";

/** What a stock figure measures: wet mass, or dry biochar where no wet estimate exists. */
export type MassBasis = "wet" | "dry";

/**
 * Whether a mass shown at one decimal (feedstock wet mass, dry biochar) renders
 * as zero. A negative stock is not empty: it is the reconcile signal.
 */
export function isMassEmpty(kg: number | null | undefined): boolean {
  return kg != null && kg >= 0 && massKgRoundsToZero(kg);
}

/** Whether a whole-kilogram figure (a wet estimate, a lane total) renders as zero. */
export function isWholeKgEmpty(kg: number | null | undefined): boolean {
  return kg != null && kg >= 0 && kg < WET_ESTIMATE_DISPLAY_MIN_KG;
}

/**
 * Whether an output bin reads Empty. The bin leads with its wet estimate, so
 * that figure's precision decides; without one, the dry biochar it leads with.
 */
export function isOutputStockEmpty(wetKg: number | null | undefined, dryKg: number | null | undefined): boolean {
  return wetKg != null ? isWholeKgEmpty(wetKg) : isMassEmpty(dryKg);
}
