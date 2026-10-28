import type { OutputStockHistoryEntry } from "@/types/output-stock";

/** Physical time, then the order the entries were recorded in. */
export function stockOrder(a: OutputStockHistoryEntry, b: OutputStockHistoryEntry): number {
  return a.occurredAt.localeCompare(b.occurredAt) || a.recordedAt.localeCompare(b.recordedAt);
}

