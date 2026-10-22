/**
 * The output bin's history as days: each day with the stock at its end, each
 * entry with what it changed per part (dry biochar, each ingredient's solids,
 * the water the records estimate, wet mass as the total) and the stock after.
 * Figures come from the replay the stock chart reads (`replayStock`), so a
 * back-dated entry lands on its own day and both views agree. A figure without
 * an honest value is left out, never shown as zero or as a placeholder.
 */
import { DRY_BIOCHAR_LABEL, ingredientSolidsLabel } from "@/components/biochar-products/product-composition-components";
import { MASS_KG_STORAGE_DECIMALS } from "@/config/numeric-storage";
import { STOCK_PART_MIN_KG } from "@/config/output-stock";
import { formatFacilityDay, formatMassKg } from "@/lib/format-utils";
import { ESTIMATED_WATER_LABEL } from "@/lib/output-stock/labels";
import { stockWaterKg } from "@/lib/output-stock/stock-parts";
import { replayStock, type StockState } from "@/lib/output-stock/stock-replay";
import type { OutputStockHistoryEntry } from "@/types/output-stock";
import { formatWetEstimate } from "./stock-preview-shared";

/** Wet mass as the parts table's total row. */
export const WET_MASS_LABEL = "Wet mass";

export interface HistoryPart {
  label: string;
  /** Null when the entry's change has no honest figure, though the stock after has one. */
  changeKg: number | null;
  afterKg: number;
  /** Water by the records: an estimate, read like the wet mass it is part of. */
  estimated?: boolean;
}

/** A change with a real minus sign, and a plus for stock in. Never "-0": a change that shows as zero reads as zero. */
export function signedKg(kg: number, format: (kg: number) => string = formatMassKg): string {
  const magnitude = format(Math.abs(kg));
  if (magnitude === format(0)) return magnitude;
  return `${kg > 0 ? "+" : "−"}${magnitude}`;
}

/** Wet mass and the water in it are estimates, read in whole kg as the bin's headline reads them. */
export function estimateKg(kg: number): string {
  return `${formatWetEstimate(kg)} kg`;
}

/**
 * The Change and After figures of one part. Estimates read in whole kg and
 * other parts in one decimal, but a change those would round to nothing (2 kg
 * of wet mass at 10% moisture takes 0.2 kg of water) is shown with the one
 * decimal `formatMassKg` keeps, and below that with the decimals a mass is
 * stored at (`MASS_KG_STORAGE_DECIMALS`). Both columns use the same precision,
 * so the row still adds up and a change is never hidden.
 */
export function formatPartFigures(part: HistoryPart): { change: string | null; after: string } {
  const formats = [
    ...(part.estimated ? [estimateKg] : []),
    formatMassKg,
    (kg: number) => formatMassKg(kg, { digits: MASS_KG_STORAGE_DECIMALS }),
  ];
  const change = part.changeKg;
  const format = change === null || change === 0
    ? formats[0]
    : formats.find((candidate) => candidate(Math.abs(change)) !== candidate(0)) ?? formats[formats.length - 1];
  return { change: change === null ? null : signedKg(change, format), after: format(part.afterKg) };
}

export type HistoryRowStatus = "counts" | "replaced" | "reversed";

export interface HistoryRow {
  entry: OutputStockHistoryEntry;
  /** The movement kind the entry reads as: the original kind for a correction. */
  kind: string;
  status: HistoryRowStatus;
  /** The correction that replaced this entry. */
  replacedBy?: OutputStockHistoryEntry;
  /** The reversal that cancelled this entry: with no correction after it, the entry was deleted. */
  reversedBy?: OutputStockHistoryEntry;
  /** The entry this correction replaces. */
  replaces?: OutputStockHistoryEntry;
  /** The "Moisture updated" row this movement's reading added. */
  moistureEntry?: OutputStockHistoryEntry;
  /** What changed per part, with the stock after; empty for an entry that no longer counts. */
  parts: HistoryPart[];
  /** Wet mass as the total, when both sides have a figure. */
  wet: { changeKg: number; afterKg: number } | null;
}

export interface HistoryDay {
  /** The facility day, as the list shows it. */
  day: string;
  /** The stock when the day ended. */
  end: StockState;
  /** Newest first. */
  rows: HistoryRow[];
}

/** Half a storage step: the smallest change worth a row. */
const MIN_SHOWN_CHANGE_KG = 0.5 * 10 ** -MASS_KG_STORAGE_DECIMALS;

/** Rounding left over after a bin empties reads as nothing, never as a negative mass. */
function settled(kg: number): number {
  return Math.abs(kg) < STOCK_PART_MIN_KG ? 0 : kg;
}

/** What one counting entry changed per part, in the order the bin is made up; a part it left unchanged is left out. */
export function entryParts(before: StockState, after: StockState, entry: OutputStockHistoryEntry): HistoryPart[] {
  // A part is left out only when its change is below what a mass is stored at.
  const changed = (part: HistoryPart) => part.changeKg === null || Math.abs(part.changeKg) >= MIN_SHOWN_CHANGE_KG;
  const ingredients = (entry.ingredientSolidsDeltas ?? []).map((part) => ({
    label: ingredientSolidsLabel(part.name), changeKg: part.solidsKg, afterKg: settled(after.ingredients.get(part.name) ?? 0),
  }));
  const waterAfter = stockWaterKg(after);
  const waterBefore = stockWaterKg(before);
  const water = waterAfter === null ? [] : [{ label: ESTIMATED_WATER_LABEL, changeKg: waterBefore === null ? null : waterAfter - waterBefore, afterKg: waterAfter, estimated: true }];
  return [{ label: DRY_BIOCHAR_LABEL, changeKg: -entry.dryMassKg, afterKg: settled(after.dryKg) }, ...ingredients, ...water].filter(changed);
}

/**
 * The history as days, newest first. A correction's reversal folds into the
 * entry it cancels, which stays in the list, struck through, as "Replaced" (a
 * correction took its place) or "Reversed"; the correction is its own entry. A
 * reading's "Moisture updated" row folds into the movement that measured it.
 * `movementId` keeps one movement (and its reading) on show, with every figure
 * still worked out from the whole history.
 */
export function buildHistoryDays(entries: readonly OutputStockHistoryEntry[], timeZone: string, movementId?: string): HistoryDay[] {
  const ids = new Set(entries.map((entry) => entry.id));
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const reversalFor = new Map(entries.filter((entry) => entry.kind === "reversal" && entry.correctsMovementId !== null && ids.has(entry.correctsMovementId)).map((entry) => [entry.correctsMovementId as string, entry]));
  const replacementFor = new Map(entries.filter((entry) => entry.kind !== "reversal" && entry.correctsMovementId).map((entry) => [entry.correctsMovementId as string, entry]));
  const originalKind = (entry: OutputStockHistoryEntry, seen = new Set<string>()): string => {
    if (entry.eventKind) return entry.eventKind;
    const original = entry.correctsMovementId ? byId.get(entry.correctsMovementId) : undefined;
    if (!original || seen.has(original.id)) return entry.kind;
    seen.add(original.id);
    return originalKind(original, seen);
  };
  const folded = (entry: OutputStockHistoryEntry) =>
    (entry.kind === "reversal" && entry.correctsMovementId !== null && ids.has(entry.correctsMovementId))
    || (entry.kind === "moisture_update" && !!entry.measuredByMovementId && ids.has(entry.measuredByMovementId));

  const days = new Map<string, HistoryDay>();
  for (const { entry, moves: counts, before, after: state } of replayStock(entries)) {
    const day = formatFacilityDay(entry.occurredAt, timeZone);
    const group = days.get(day) ?? { day, end: state, rows: [] };
    group.end = state;
    days.set(day, group);
    if (folded(entry)) continue;
    if (movementId && entry.id !== movementId && entry.measuredByMovementId !== movementId) continue;
    const wet = counts && state.wetKg !== null && before.wetKg !== null ? { changeKg: state.wetKg - before.wetKg, afterKg: state.wetKg } : null;
    group.rows.push({
      entry,
      kind: entry.kind === "replacement" || (entry.correctsMovementId && entry.kind !== "reversal") ? originalKind(entry) : entry.kind,
      status: reversalFor.has(entry.id) ? (replacementFor.has(entry.id) ? "replaced" : "reversed") : "counts",
      replacedBy: replacementFor.get(entry.id),
      reversedBy: reversalFor.get(entry.id),
      replaces: entry.correctsMovementId && entry.kind !== "reversal" ? byId.get(entry.correctsMovementId) : undefined,
      moistureEntry: entries.find((other) => other.kind === "moisture_update" && other.measuredByMovementId === entry.id),
      parts: counts ? entryParts(before, state, entry) : [],
      wet,
    });
  }
  return [...days.values()].reverse().filter((group) => group.rows.length > 0).map((group) => ({ ...group, rows: group.rows.reverse() }));
}

const VERBS: Record<string, string> = {
  intake: "Added", delivery: "Delivered", loss: "Lost", count: "Counted", production_draw: "Withdrew", product_draw: "Withdrew", reversal: "Reversed",
};
const NOUNS: Record<string, string> = {
  intake: "addition", delivery: "delivery", loss: "lost mass", count: "stock count", production_draw: "withdrawal", product_draw: "withdrawal",
};

/**
 * The entry's own size: what was weighed (wet mass). Every run and product
 * enters with a wet mass; a movement whose saved snapshot has no wet figure
 * reads by the dry biochar it moved.
 */
export function entryAmount(entry: OutputStockHistoryEntry, kind: string, format: (kg: number) => string): string {
  if (kind === "count") return entry.wetMassKg === null ? `${format(entry.afterDryKg)} dry biochar` : `${format(entry.wetMassKg)} wet mass`;
  return entry.wetMassKg === null ? `${format(Math.abs(entry.dryMassKg))} dry biochar` : `${format(entry.wetMassKg)} wet mass`;
}

/** The line an entry reads as: "Added 300 kg wet mass", "Corrected delivery: 250 kg wet mass". */
export function entrySentence(row: Pick<HistoryRow, "entry" | "kind" | "replaces">, format: (kg: number) => string): string {
  const amount = entryAmount(row.entry, row.kind, format);
  if (row.replaces) return `Corrected ${NOUNS[row.kind] ?? "entry"}: ${amount}`;
  return `${VERBS[row.kind] ?? "Changed"} ${amount}`;
}

