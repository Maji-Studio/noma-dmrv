/**
 * Which sub-bins of a split bin a load reaches, for the form's reading rows.
 *
 * The planner (`planOutputStock`, kind `ordered`) is the authority and works in
 * exact rationals. This walk only decides which rows to show: every sub-bin
 * except the last is emptied at its moisture, so a row appears once the weight
 * passes what the sub-bins before it hold wet. A typed reading sets a
 * sub-bin's wet content; until then its estimate stands in, so the rows move
 * as the operator types.
 */

const PERCENT = 100;
/**
 * Floating-point slack only: the planner closes a sub-bin at its exact wet
 * content and no further, so a load even a gram over reaches the next row.
 */
const CLOSE_TOLERANCE_KG = 1e-6;

/** What the walk needs to know about one sub-bin. */
export interface SubBinCapacity {
  layerId: string;
  solidsKg: number;
  /** The sub-bin's estimated moisture; null when nothing dates it. */
  estimatedMoisturePercent: number | null;
}

export interface SubBinRow {
  layerId: string;
  /** True when the load empties this sub-bin and carries on to the next. */
  emptied: boolean;
  /** Wet mass the load takes from this sub-bin; null while its moisture is unknown. */
  wetKg: number | null;
}

export interface SubBinRowPlan {
  /** One row per sub-bin the load reaches, in drain order. */
  rows: SubBinRow[];
  /** Ordered sub-bins the load is used up before reaching; empty until the walk completes. */
  unreached: string[];
  /** Wet mass left over once every ordered sub-bin is emptied. */
  shortfallWetKg: number;
  /** False while the weight or a moisture it depends on is still missing. */
  complete: boolean;
}

export type SubBinReadings = Readonly<Record<string, number | null | undefined>>;

function usablePercent(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < PERCENT ? value : null;
}

/** The rows a load of `loadWetKg` reaches, draining `ordered` in order. */
export function planSubBinRows(ordered: readonly SubBinCapacity[], readings: SubBinReadings, loadWetKg: number | null | undefined): SubBinRowPlan {
  const rows: SubBinRow[] = [];
  const first = ordered[0];
  if (!first) return { rows, unreached: [], shortfallWetKg: 0, complete: false };
  // Any load starts in the first sub-bin, so its row shows before the weight does.
  if (typeof loadWetKg !== 'number' || !Number.isFinite(loadWetKg) || loadWetKg <= 0) {
    return { rows: [{ layerId: first.layerId, emptied: false, wetKg: null }], unreached: [], shortfallWetKg: 0, complete: false };
  }
  let remaining = loadWetKg;
  for (const [index, subBin] of ordered.entries()) {
    const moisture = usablePercent(readings[subBin.layerId]) ?? usablePercent(subBin.estimatedMoisturePercent);
    if (moisture === null) {
      rows.push({ layerId: subBin.layerId, emptied: false, wetKg: null });
      return { rows, unreached: [], shortfallWetKg: 0, complete: false };
    }
    const wetContentKg = subBin.solidsKg / (1 - moisture / PERCENT);
    if (remaining <= wetContentKg + CLOSE_TOLERANCE_KG) {
      rows.push({ layerId: subBin.layerId, emptied: false, wetKg: remaining });
      return { rows, unreached: ordered.slice(index + 1).map(s => s.layerId), shortfallWetKg: 0, complete: true };
    }
    rows.push({ layerId: subBin.layerId, emptied: true, wetKg: wetContentKg });
    remaining -= wetContentKg;
  }
  return { rows, unreached: [], shortfallWetKg: remaining, complete: true };
}

/** The draw's sources once every reached sub-bin has a reading, else null. */
export function subBinSources(plan: SubBinRowPlan, readings: SubBinReadings): { layerId: string; moisturePercent: number }[] | null {
  const sources = plan.rows.map(row => ({ layerId: row.layerId, moisturePercent: usablePercent(readings[row.layerId]) }));
  return sources.length && sources.every(s => s.moisturePercent !== null)
    ? sources.map(s => ({ layerId: s.layerId, moisturePercent: s.moisturePercent! }))
    : null;
}

/** Oldest first without an operator order; otherwise the ticked sub-bins still in the bin, in that order. */
export function orderSubBins<T extends { layerId: string }>(subBins: readonly T[], order: readonly string[] | null): T[] {
  if (!order) return [...subBins];
  const byId = new Map(subBins.map(subBin => [subBin.layerId, subBin]));
  return order.flatMap(id => byId.get(id) ?? []);
}

/** One step up (-1) or down (1), or a drop at a position. Out-of-range moves leave the order as it is. */
export function moveSubBin(order: readonly string[], layerId: string, move: -1 | 1 | { to: number }): string[] {
  const from = order.indexOf(layerId);
  const to = typeof move === 'number' ? from + move : move.to;
  if (from < 0 || to < 0 || to >= order.length || to === from) return [...order];
  const next = order.filter(id => id !== layerId);
  next.splice(to, 0, layerId);
  return next;
}
