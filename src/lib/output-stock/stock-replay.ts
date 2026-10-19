/**
 * The output bin's stock replayed from its history: the one rule the stock
 * chart and the history both read. Live entries replay their frozen changes
 * in physical time, so a back-dated entry lands where it happened, and a
 * correction pair cancels out. Dry biochar always has a figure. Wet mass and
 * solids turn unknown at an entry with no figure for them, and become known
 * again when the bin is emptied or a movement's own frozen balance after it
 * gives one (a count whose reading sets the estimate, or a draw that used up
 * the batch with no moisture basis).
 */
import { STOCK_PART_MIN_KG } from "@/config/output-stock";
import type { OutputStockHistoryEntry } from "@/types/output-stock";

/** Kinds that move no stock: a mode change, or a reading's row that folds into its movement. */
const NO_STOCK_KINDS = new Set(["merge", "split", "moisture_update"]);

/** The bin's stock at one point of the replay. */
export interface StockState {
  dryKg: number;
  /** Null while the records give no solids figure. */
  solidsKg: number | null;
  /** Null while the records give no wet figure. */
  wetKg: number | null;
  /** Ingredient solids by material, in the order they first entered. */
  ingredients: ReadonlyMap<string, number>;
}

export const EMPTY_STOCK: StockState = { dryKg: 0, solidsKg: 0, wetKg: 0, ingredients: new Map() };

/** One entry of the replay, in physical time, with the stock either side of it. */
export interface StockStep {
  entry: OutputStockHistoryEntry;
  /** False for a correction pair that cancels out. */
  live: boolean;
  /** True when the entry counts toward the stock: live, and a kind that moves stock. */
  moves: boolean;
  before: StockState;
  after: StockState;
}

/** Physical time, then the order the entries were recorded in. */
export function stockOrder(a: OutputStockHistoryEntry, b: OutputStockHistoryEntry): number {
  return a.occurredAt.localeCompare(b.occurredAt) || a.recordedAt.localeCompare(b.recordedAt);
}

/** Cancel each reversal with its target when present, keeping unmatched reversals for the totals. */
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

/** A running balance: unknown stays unknown, and a change with no figure makes it unknown. */
function runningKg(balance: number | null, change: number | null | undefined): number | null {
  return balance === null || change == null ? null : balance + change;
}

/** The frozen balance a movement recorded right after itself; a reversal carries its target's, so it has none. */
function frozenAfter(entry: OutputStockHistoryEntry, value: number | null | undefined): number | null {
  return entry.kind === "reversal" || value == null ? null : value;
}

/** The stock after one counting entry. */
export function applyStockEntry(state: StockState, entry: OutputStockHistoryEntry): StockState {
  const dryKg = state.dryKg - entry.dryMassKg;
  const ingredients = new Map(state.ingredients);
  for (const part of entry.ingredientSolidsDeltas ?? []) ingredients.set(part.name, (ingredients.get(part.name) ?? 0) + part.solidsKg);
  let solidsKg = runningKg(state.solidsKg, entry.solidsDeltaKg) ?? frozenAfter(entry, entry.afterSolidsKg);
  let wetKg = runningKg(state.wetKg, entry.wetDeltaKg) ?? frozenAfter(entry, entry.afterWetKg);
  // An emptied bin holds nothing, whatever the batches it held were missing.
  if (Math.abs(dryKg) < STOCK_PART_MIN_KG) {
    solidsKg ??= 0;
    wetKg ??= 0;
  }
  return { dryKg, solidsKg, wetKg, ingredients };
}

/** Every entry in physical time, with the stock before and after it; an entry that does not count leaves the stock as it was. */
export function replayStock(entries: readonly OutputStockHistoryEntry[]): StockStep[] {
  const live = new Set(liveChartEntries(entries).map(entry => entry.id));
  let state = EMPTY_STOCK;
  return [...entries].sort(stockOrder).map((entry) => {
    const before = state;
    const isLive = live.has(entry.id);
    const moves = isLive && !NO_STOCK_KINDS.has(entry.kind);
    if (moves) state = applyStockEntry(state, entry);
    return { entry, live: isLive, moves, before, after: state };
  });
}
