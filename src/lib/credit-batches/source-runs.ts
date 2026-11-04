/**
 * Which production runs a planned draw or share takes biochar from, by the
 * rule each saved lineage read applies. Pure, so each rule is tested without
 * a database:
 * - a delivery keeps a run whose drawn dry biochar, summed over every layer
 *   it came through, is above zero (the delivery lineage's
 *   `having sum(dry_mass_kg) > 0`);
 * - a biochar product keeps every run layer its draw touches, even a
 *   residual one with no dry gram left: the product writer saves a source
 *   allocation for each, and the product lineage matches any of them;
 * - an application share keeps a run when the share has any wet or dry mass
 *   (the application lineage's `wet_mass_kg > 0 or dry_mass_kg > 0`).
 */
import type { OutputStockLayer } from "@/lib/output-stock/planner";

/** One layer of a planned output draw, with the run shares inside it. */
export interface DrawnLayer {
  layerId: string;
  runs: readonly { productionRunId: string; dryMassKg: number }[];
}

/** One share of an application, per product and run. */
export interface RunShare {
  productionRunId: string;
  wetMassKg: number;
  dryMassKg: number;
}

/** Runs a delivery draw takes dry biochar from, in first-seen order. */
export function drawnSourceRunIds(layers: readonly Pick<DrawnLayer, "runs">[]): string[] {
  const totals = new Map<string, number>();
  for (const layer of layers) {
    for (const run of layer.runs) totals.set(run.productionRunId, (totals.get(run.productionRunId) ?? 0) + run.dryMassKg);
  }
  return [...totals].filter(([, dryKg]) => dryKg > 0).map(([id]) => id);
}

/** Runs a product draw saves source allocations for: each biochar layer is one run. */
export function productSourceRunIds(layers: readonly Pick<DrawnLayer, "layerId">[]): string[] {
  return [...new Set(layers.map(layer => layer.layerId))];
}

/** Layers a draw at `at` could still reach: placed by then, with dry biochar or residual solids left. */
export function heldLayers(layers: readonly OutputStockLayer[], at: string): OutputStockLayer[] {
  return layers.filter(layer => layer.placedAt <= at &&
    (Number(layer.remainingDryBiocharKg) > 0 || (layer.remainingSolidsKg?.numerator ?? BigInt(0)) > BigInt(0)));
}

/** Runs an application's shares take any biochar from, in first-seen order. */
export function sharedSourceRunIds(shares: readonly RunShare[]): string[] {
  return [...new Set(shares.filter(share => share.wetMassKg > 0 || share.dryMassKg > 0).map(share => share.productionRunId))];
}
