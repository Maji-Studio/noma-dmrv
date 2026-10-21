/**
 * Which production runs a planned draw or share takes biochar from. Pure, so
 * the rule each saved lineage read applies is tested without a database:
 * - a delivery or product draw keeps a run whose drawn dry biochar, summed
 *   over every layer it came through, is above zero (the delivery lineage's
 *   `having sum(dry_mass_kg) > 0`);
 * - an application share keeps a run when the share has any wet or dry mass
 *   (the application lineage's `wet_mass_kg > 0 or dry_mass_kg > 0`).
 */

/** One layer of a planned output draw, with the run shares inside it. */
export interface DrawnLayer {
  runs: readonly { productionRunId: string; dryMassKg: number }[];
}

/** One share of an application, per product and run. */
export interface RunShare {
  productionRunId: string;
  wetMassKg: number;
  dryMassKg: number;
}

/** Runs a planned draw takes dry biochar from, in first-seen order. */
export function drawnSourceRunIds(layers: readonly DrawnLayer[]): string[] {
  const totals = new Map<string, number>();
  for (const layer of layers) {
    for (const run of layer.runs) totals.set(run.productionRunId, (totals.get(run.productionRunId) ?? 0) + run.dryMassKg);
  }
  return [...totals].filter(([, dryKg]) => dryKg > 0).map(([id]) => id);
}

/** Runs an application's shares take any biochar from, in first-seen order. */
export function sharedSourceRunIds(shares: readonly RunShare[]): string[] {
  return [...new Set(shares.filter(share => share.wetMassKg > 0 || share.dryMassKg > 0).map(share => share.productionRunId))];
}
