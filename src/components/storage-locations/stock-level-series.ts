import { outputStockEventLabel } from "@/lib/output-stock/labels";
import { replayStock } from "@/lib/output-stock/stock-replay";
import type { OutputStockHistoryEntry } from "@/types/output-stock";

export interface StockLevelPoint {
  t: number;
  dryKg: number;
  waterKg: number | null;
  ingredientsKg?: number;
  label?: string;
}
export interface StockModeChange { t: number; kind: string }

/**
 * The shared stock replay (`replayStock`) as chart points. Departure readings
 * never reset the remaining stock. Counts carry their saved wet delta; a
 * missing historical basis leaves water unknown until the replay knows it again.
 */
export function buildStockLevelSeries(entries: readonly OutputStockHistoryEntry[]) {
  const points: StockLevelPoint[] = [];
  const modeChanges: StockModeChange[] = [];
  for (const { entry, live, moves, after } of replayStock(entries)) {
    const t = Date.parse(entry.occurredAt);
    if (live && (entry.kind === "merge" || entry.kind === "split")) modeChanges.push({ t, kind: entry.kind });
    // Mode changes and reading rows are explanatory metadata, not stock movements.
    if (!moves) continue;
    if (points.length === 0) points.push({ t, dryKg: 0, waterKg: 0, label: "Before" });
    const { dryKg, solidsKg, wetKg } = after;
    points.push({ t, dryKg: Math.max(dryKg, 0),
      ingredientsKg: solidsKg === null ? undefined : Math.max(solidsKg - dryKg, 0),
      waterKg: wetKg === null || solidsKg === null ? null : Math.max(wetKg - solidsKg, 0),
      label: outputStockEventLabel(entry.kind === "replacement" ? entry.eventKind ?? entry.kind : entry.kind),
    });
  }
  return { points, modeChanges };
}
