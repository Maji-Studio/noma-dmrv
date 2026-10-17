/**
 * PROTOTYPE (issue #1004, throwaway, never merges): the part model and the
 * fixture entries behind the bin history variants. Nothing here is read from
 * the database.
 *
 * Three variants of one question: how does a history entry show every part of
 * the mix (dry biochar, each blend ingredient, water) before and after, while
 * the wet total stays the headline? Switch with `?variant=A|B|C` on the
 * storage-locations page, open a product bin, then its History.
 */
import type { OutputStockHistoryEntry } from "@/types/output-stock";

export type PartKind = "biochar" | "ingredient" | "water";

export interface Part {
  key: string;
  label: string;
  kind: PartKind;
  /** Null when the records cannot give it: only ever the water part. */
  kg: number | null;
  /** Position among the ingredients, for the accent fill. */
  index?: number;
}

export interface Side {
  /** Wet stock from the records; null when a batch has no moisture basis. */
  wetKg: number | null;
  parts: Part[];
}

export interface EntryParts { before: Side; after: Side }

export const WATER_LABEL = "Water";
export const WATER_SOURCE = "from the records";
export const WATER_UNKNOWN = "Unknown until the next count";
const EPSILON_KG = 1e-6;

/**
 * Water is wet stock less solids. Two cases have no honest figure and say so
 * instead of a floored 0 kg: no wet figure at all (a batch without a moisture
 * basis), and less wet stock than solids (wetter removals used the water up).
 */
export function resolveWater(wetKg: number | null, solidsKg: number): number | null {
  if (wetKg === null) return null;
  if (wetKg < solidsKg - EPSILON_KG) return null;
  if (wetKg <= 0 && solidsKg > 0) return null;
  return wetKg - solidsKg;
}

export function side(wetKg: number | null, biocharKg: number, ingredients: [string, number][] = []): Side {
  const solids = biocharKg + ingredients.reduce((total, [, kg]) => total + kg, 0);
  return {
    wetKg,
    parts: [
      { key: "biochar", label: "Dry biochar", kind: "biochar", kg: biocharKg },
      ...ingredients.map(([label, kg], index) => ({ key: label, label, kind: "ingredient" as const, kg, index })),
      { key: "water", label: WATER_LABEL, kind: "water", kg: resolveWater(wetKg, solids) },
    ],
  };
}

const EMPTY = side(0, 0);
const AFTER_T1 = side(300, 246);
const AFTER_T2 = side(800, 486, [["Compost", 150]]);
const AFTER_T3 = side(1200, 686, [["Compost", 230], ["Wood ash", 40]]);
const AFTER_T4 = side(900, 540, [["Compost", 150], ["Wood ash", 30]]);
// Wetter removals took the recorded wet stock to zero while solids remain.
const AFTER_T5 = side(0, 480, [["Compost", 130], ["Wood ash", 30]]);
// A batch with no moisture basis: wet is unknown, so is water.
const AFTER_T6 = side(null, 600, [["Compost", 130], ["Wood ash", 30]]);

export const PROTO_PARTS: Record<string, EntryParts> = {
  t1: { before: EMPTY, after: AFTER_T1 },
  t2: { before: AFTER_T1, after: AFTER_T2 },
  t3: { before: AFTER_T2, after: AFTER_T3 },
  t4: { before: AFTER_T3, after: AFTER_T4 },
  t5: { before: AFTER_T4, after: AFTER_T5 },
  t6: { before: AFTER_T5, after: AFTER_T6 },
};

function allocation(code: string, wetMassKg: number | null, dryMassKg: number) {
  return { layerId: code, code, wetMassKg, dryMassKg, runs: [] };
}

function entry(id: string, kind: string, at: string, wet: number | null, dry: number, moisture: number | null, reason: string,
  codes: [string, number][]): OutputStockHistoryEntry {
  const parts = PROTO_PARTS[id];
  return {
    id, kind, occurredAt: `${at}:00.000Z`, recordedAt: `${at}:00.000Z`, actorName: "Operator", reason,
    wetMassKg: wet, moisturePercent: moisture, dryMassKg: dry,
    beforeDryKg: parts.before.parts[0].kg ?? 0, afterDryKg: parts.after.parts[0].kg ?? 0,
    correctsMovementId: null, deliveryId: null,
    allocations: codes.map(([code, kg]) => allocation(code, null, kg)),
  };
}

/** Newest first, as the history shows them. Dry mass is signed: intakes negative, removals positive. */
export const PROTO_ENTRIES: OutputStockHistoryEntry[] = [
  entry("t6", "intake", "2026-10-17T10:15", null, -120, null, "", [["BC-0431", 120]]),
  entry("t5", "product_draw", "2026-10-17T08:30", 900, 60, 24, "Product PRD-090", [["PRD-022", 60]]),
  entry("t4", "product_draw", "2026-10-16T14:20", 300, 146, 21, "Product PRD-088", [["PRD-022", 96], ["PRD-023", 50]]),
  entry("t3", "intake", "2026-10-15T11:05", 400, -200, 20, "", [["PRD-023", 200]]),
  entry("t2", "intake", "2026-10-14T15:40", 500, -240, 22, "", [["PRD-022", 240]]),
  entry("t1", "intake", "2026-10-14T09:10", 300, -246, 18, "", [["PRD-021", 246]]),
];

/** No honest wet figure: no basis at all, or wet at zero while solids remain. */
export function wetUnknown(side: Side): boolean {
  const solids = side.parts.reduce((total, part) => total + (part.kind === "water" ? 0 : part.kg ?? 0), 0);
  return side.wetKg === null || (side.wetKg <= 0 && solids > 0);
}

/** The wet headline. `short` is the entry line's right-hand figure. */
export function formatWet(side: Side, short = false): string {
  if (wetUnknown(side)) return short ? "Not available" : "Unknown until the next count";
  return `≈ ${(side.wetKg ?? 0).toLocaleString()} kg wet`;
}

export function formatKg(kg: number): string {
  return `${kg.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg`;
}

/** Change of one part across the entry, signed, or null while either side is unknown. */
export function partDelta(before: Part | undefined, after: Part): number | null {
  const was = before?.kg ?? (before ? null : 0);
  if (was === null || after.kg === null) return null;
  return after.kg - was;
}
