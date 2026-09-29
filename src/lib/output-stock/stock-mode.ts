export const OUTPUT_STOCK_MODES = ['split', 'mix'] as const;
export type OutputStockMode = (typeof OUTPUT_STOCK_MODES)[number];

/** A timed switch of a bin's stock mode: a merge (to mix) or a switch back to split once empty. */
export interface StockModeChange {
  to: OutputStockMode;
  /** Canonical ISO instant the change took effect. */
  at: string;
  /** Posting order; breaks ties at one instant. */
  sequence: bigint;
}

/**
 * An output bin's stock mode at `at` (canonical ISO instants): the mode set by
 * the latest change at or before `at`, or, before the first change, the mode
 * that change switched away from. A draw is planned in the mode in force at its
 * own time, so an entry timed before a merge stays split and one timed in a
 * mix period stays mix after the bin is switched back to split.
 */
export function stockModeAt(current: OutputStockMode, changes: readonly StockModeChange[], at: string): OutputStockMode {
  if (!changes.length) return current;
  const ordered = [...changes].sort((a, b) => a.at.localeCompare(b.at) || (a.sequence < b.sequence ? -1 : a.sequence > b.sequence ? 1 : 0));
  const inForce = ordered.filter(change => change.at <= at).at(-1);
  if (inForce) return inForce.to;
  return ordered[0].to === 'mix' ? 'split' : 'mix';
}
