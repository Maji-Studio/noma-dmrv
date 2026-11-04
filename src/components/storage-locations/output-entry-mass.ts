import { formatMassKg } from "@/lib/format-utils";
import { outputStockFigure } from "./stock-preview-shared";
import type { OutputStockHistoryEntry } from "@/types/output-stock";

/**
 * An output stock entry's own size, unsigned: its wet kg when it was weighed
 * wet, else its dry biochar. The history line adds the sign; the delete dialog
 * uses it as is.
 */
export function outputEntryMass(entry: Pick<OutputStockHistoryEntry, "wetMassKg" | "dryMassKg">): string {
  return entry.wetMassKg === null ? outputStockFigure(null, Math.abs(entry.dryMassKg)) : `${formatMassKg(entry.wetMassKg)} wet mass`;
}
