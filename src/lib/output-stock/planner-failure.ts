import { rationalToNumber } from './exact';
import { InsufficientSolidsError, SubBinOverdrawError } from './planner';

/**
 * What a shortage's solids are: dry biochar alone in a biochar bin, or dry
 * biochar plus a blend's ingredient solids in a product bin.
 */
export type OutputStockSolidsMeasure = 'dry_biochar' | 'total_solids';

/**
 * A capacity failure: the bin, or one chosen sub-bin, holds fewer solids than
 * the movement takes. Quantities are exact solids in kilograms, and `measure`
 * says which solids, so a product bin's total solids are never read as dry biochar.
 */
export interface OutputStockShortage {
  storageLocationId: string;
  /** The chosen sub-bin that is short, when one sub-bin rather than the bin is short. */
  layerId?: string;
  measure: OutputStockSolidsMeasure;
  availableSolidsKg: number;
  requestedSolidsKg: number;
}

/**
 * Why a movement could not be planned. Only a capacity failure is a stock
 * shortage; everything else is a request the caller has to change.
 */
export type OutputStockBlocking =
  | ({ kind: 'insufficient_stock' } & OutputStockShortage)
  | { kind: 'invalid_request' };

/**
 * Classifies a planner refusal for typed callers. The operator message is
 * built separately and stays as it was.
 *
 * Capacity failures (planner.ts): `InsufficientSolidsError`, the measured
 * solids exceed the eligible layers' solids; `SubBinOverdrawError`, the load
 * leaves more solids for the last chosen sub-bin than it holds. A load drawn
 * through every sub-bin the bin holds is short of the bin, as its message says.
 *
 * Everything else is `invalid_request`: sub-bins missing, repeated, not
 * present at the time, empty, or never reached by the load (`UntickSubBinError`);
 * a non-positive draw or one below a gram of dry biochar; a reading at 100
 * percent moisture; a sub-bin order on a mix bin; and the ledger invariants
 * (layer identity, balances, provenance) that no larger bin would fix.
 */
export function classifyPlannerFailure(error: RangeError, context: { storageLocationId: string; lane: 'biochar' | 'product'; drawsWholeBin: boolean }): OutputStockBlocking {
  const { storageLocationId } = context;
  const measure: OutputStockSolidsMeasure = context.lane === 'biochar' ? 'dry_biochar' : 'total_solids';
  if (error instanceof InsufficientSolidsError) {
    return { kind: 'insufficient_stock', storageLocationId, measure,
      availableSolidsKg: rationalToNumber(error.availableSolidsKg), requestedSolidsKg: rationalToNumber(error.requestedSolidsKg) };
  }
  if (error instanceof SubBinOverdrawError) {
    const { solids } = error;
    return context.drawsWholeBin
      ? { kind: 'insufficient_stock', storageLocationId, measure,
        availableSolidsKg: rationalToNumber(solids.selectedAvailableKg), requestedSolidsKg: rationalToNumber(solids.selectedRequestedKg) }
      : { kind: 'insufficient_stock', storageLocationId, layerId: error.layerId, measure,
        availableSolidsKg: rationalToNumber(solids.availableKg), requestedSolidsKg: rationalToNumber(solids.requestedKg) };
  }
  return { kind: 'invalid_request' };
}
