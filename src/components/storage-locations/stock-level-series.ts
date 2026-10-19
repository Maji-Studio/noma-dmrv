import { outputStockEventLabel } from "@/lib/output-stock/labels";
import type { OutputStockHistoryEntry } from "@/types/output-stock";

export interface StockLevelPoint {
  t: number;
  dryKg: number;
  waterKg: number | null;
  ingredientsKg?: number;
  label?: string;
}
export interface StockModeChange { t: number; kind: string }

/** Cancel each reversal with its target when present, keeping unmatched reversals for chart totals. */
export function liveChartEntries(entries: readonly OutputStockHistoryEntry[]): OutputStockHistoryEntry[] {
  const entryIds = new Set(entries.map(entry => entry.id));
  const cancelledIds = new Set<string>();
  for (const entry of entries) {
    if (entry.kind === "reversal" && entry.correctsMovementId !== null && entryIds.has(entry.correctsMovementId)) {
      cancelledIds.add(entry.id);
      cancelledIds.add(entry.correctsMovementId);
    }
  }
  return entries.filter(entry => !cancelledIds.has(entry.id));
}

/**
 * Replay live frozen deltas in physical time after cancelling correction pairs.
 * Departure readings never reset the remaining stock. Counts carry their
 * saved wet delta; a missing historical basis leaves water unknown.
 */
export function buildStockLevelSeries(entries: readonly OutputStockHistoryEntry[]) {
  const ordered = liveChartEntries(entries).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.recordedAt.localeCompare(b.recordedAt));
  const points: StockLevelPoint[] = [];
  const modeChanges: StockModeChange[] = [];
  let dryKg = 0;
  let solidsKg: number | null = 0;
  let wetKg: number | null = 0;
  for (const entry of ordered) {
    const t = Date.parse(entry.occurredAt);
    if (entry.kind === "merge" || entry.kind === "split") {
      modeChanges.push({ t, kind: entry.kind });
      continue;
    }
    // This is explanatory metadata, not another stock movement.
    if (entry.kind === "moisture_update") continue;
    if (points.length === 0) points.push({ t, dryKg: 0, waterKg: 0, label: "Before" });
    dryKg -= entry.dryMassKg;
    wetKg = wetKg === null || entry.wetDeltaKg == null ? null : wetKg + entry.wetDeltaKg;
    solidsKg = solidsKg === null || entry.solidsDeltaKg == null ? null : solidsKg + entry.solidsDeltaKg;
    points.push({ t, dryKg: Math.max(dryKg, 0),
      ingredientsKg: solidsKg === null ? undefined : Math.max(solidsKg - dryKg, 0),
      waterKg: wetKg === null || solidsKg === null ? null : Math.max(wetKg - solidsKg, 0),
      label: outputStockEventLabel(entry.kind === "replacement" ? entry.eventKind ?? entry.kind : entry.kind),
    });
  }
  return { points, modeChanges };
}
