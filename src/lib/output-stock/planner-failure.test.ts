import { describe, expect, it } from 'vitest';
import { operatorStockMessage } from './messages';
import { InsufficientSolidsError, planOutputStock, SubBinOverdrawError, type OutputStockLayer, type OutputStockRequest } from './planner';
import { classifyPlannerFailure } from './planner-failure';

const DAY = '2026-09-14T10:00:00.000Z';
const BIN = 'bin-id';
function layer(id: string, dry: string, ingredients = '0', sequence = BigInt(1)): OutputStockLayer {
  return { id, placedAt: DAY, postingSequence: sequence, establishedDryBiocharKg: dry, ingredientDrySolidsKg: ingredients, remainingDryBiocharKg: dry,
    runs: [{ productionRunId: id, establishedDryKg: dry, remainingDryKg: dry }] };
}
/** A product bin: 1,500 kg dry biochar and 320 kg ingredient solids, 1,820 kg solids in all. */
const blends = () => [layer('A', '900', '200'), layer('B', '600', '120', BigInt(2))];
/** A split biochar bin: 843.2 kg and 637 kg of solids. */
const bays = () => [layer('B-0412', '843.2', '0', BigInt(1)), layer('B-0419', '637', '0', BigInt(2))];

function refusal(layers: OutputStockLayer[], request: OutputStockRequest, policy?: 'fifo' | 'pro_rata'): RangeError {
  try {
    planOutputStock(layers, DAY, request, policy);
  } catch (error) {
    if (error instanceof RangeError) return error;
    throw error;
  }
  throw new Error('Expected a planner refusal');
}
const classify = (error: RangeError, drawsWholeBin = false, lane: 'biochar' | 'product' = 'product') => classifyPlannerFailure(error, { storageLocationId: BIN, lane, drawsWholeBin });

describe('capacity failures are stock shortages, in solids', () => {
  it('reports a blended bin by its total solids, not its dry biochar', () => {
    // 2,500 kg wet at 15% is 2,125 kg solids against 1,820 kg held (of which 1,500 kg is dry biochar).
    const error = refusal(blends(), { kind: 'wet', wetKg: 2500, moisturePercent: 15 });
    expect(error).toBeInstanceOf(InsufficientSolidsError);
    expect(classify(error)).toEqual({ kind: 'insufficient_stock', storageLocationId: BIN, measure: 'total_solids', availableSolidsKg: 1820, requestedSolidsKg: 2125 });
  });

  it('names a biochar bin\'s solids as dry biochar', () => {
    const error = refusal(bays(), { kind: 'solids', solidsKg: 2000 });
    expect(classify(error, false, 'biochar')).toMatchObject({ kind: 'insufficient_stock', measure: 'dry_biochar', availableSolidsKg: 1480.2 });
  });

  it('keeps the planner message the operator copy is keyed on', () => {
    const error = refusal(blends(), { kind: 'solids', solidsKg: 2000 });
    expect(error.message).toBe('Insufficient exact dry solids');
    expect(operatorStockMessage(error.message)).toMatch(/^Not enough dry biochar in the selected bin/);
    expect(classify(error)).toMatchObject({ kind: 'insufficient_stock', availableSolidsKg: 1820, requestedSolidsKg: 2000 });
  });

  it('counts only layers present at the time as available', () => {
    const later = { ...layer('later', '500', '0', BigInt(3)), placedAt: '2026-09-15T10:00:00.000Z' };
    const error = refusal([...blends(), later], { kind: 'solids', solidsKg: 2000 });
    expect(classify(error)).toMatchObject({ availableSolidsKg: 1820 });
  });

  it('reports a mix-bin shortage the same way', () => {
    const error = refusal(blends(), { kind: 'solids', solidsKg: 1900 }, 'pro_rata');
    expect(classify(error)).toMatchObject({ kind: 'insufficient_stock', availableSolidsKg: 1820, requestedSolidsKg: 1900 });
  });

  it('names the chosen sub-bin a load overdraws, with that sub-bin\'s solids', () => {
    // 843.2 / 0.70 = 1,204.571 kg wet empties B-0412; the other 995.429 kg wet at 33% asks 666.937 kg of B-0419's 637 kg.
    const error = refusal(bays(), { kind: 'ordered', wetKg: 2200, sources: [{ layerId: 'B-0412', moisturePercent: 30 }, { layerId: 'B-0419', moisturePercent: 33 }] });
    expect(error).toBeInstanceOf(SubBinOverdrawError);
    expect(error.message).toBe('Measured solids exceed the sub-bin');
    const blocking = classify(error, false, 'biochar');
    expect(blocking).toMatchObject({ kind: 'insufficient_stock', storageLocationId: BIN, layerId: 'B-0419', measure: 'dry_biochar', availableSolidsKg: 637 });
    expect(blocking.kind === 'insufficient_stock' && blocking.requestedSolidsKg).toBeCloseTo(666.937, 3);
  });

  it('reports a load through every sub-bin the bin holds as short of the bin', () => {
    const error = refusal(bays(), { kind: 'ordered', wetKg: 2200, sources: [{ layerId: 'B-0412', moisturePercent: 30 }, { layerId: 'B-0419', moisturePercent: 33 }] });
    const blocking = classify(error, true, 'biochar');
    expect(blocking).not.toHaveProperty('layerId');
    expect(blocking).toMatchObject({ kind: 'insufficient_stock', storageLocationId: BIN, availableSolidsKg: 1480.2 });
    expect(blocking.kind === 'insufficient_stock' && blocking.requestedSolidsKg).toBeCloseTo(843.2 + 666.937, 3);
  });

  it('never refuses a count: a surplus is a discrepancy and a shortfall is drawn', () => {
    expect(planOutputStock(blends(), DAY, { kind: 'count', wetKg: 5000, moisturePercent: 10 }).discrepancySolidsKg.numerator > BigInt(0)).toBe(true);
    expect(planOutputStock(blends(), DAY, { kind: 'count', wetKg: 0 }).drawnDryKg).toBe('1500.000');
  });
});

describe('everything else is a request to change', () => {
  const sub = (sources: { layerId: string; moisturePercent: number }[], wetKg = 10): OutputStockRequest => ({ kind: 'ordered', wetKg, sources });
  const empty = { ...layer('empty', '10', '0', BigInt(3)), remainingDryBiocharKg: '0', runs: [{ productionRunId: 'empty', establishedDryKg: '10', remainingDryKg: '0' }] };
  const later = { ...layer('later', '10', '0', BigInt(3)), placedAt: '2026-09-15T10:00:00.000Z' };
  it.each<[string, OutputStockLayer[], OutputStockRequest, ('fifo' | 'pro_rata')?]>([
    ['no sub-bin', bays(), sub([])],
    ['an unknown sub-bin', bays(), sub([{ layerId: 'nope', moisturePercent: 10 }])],
    ['a sub-bin twice', bays(), sub([{ layerId: 'B-0412', moisturePercent: 10 }, { layerId: 'B-0412', moisturePercent: 10 }])],
    ['a sub-bin placed after the draw', [...bays(), later], sub([{ layerId: 'later', moisturePercent: 0 }])],
    ['an empty sub-bin', [...bays(), empty], sub([{ layerId: 'empty', moisturePercent: 0 }])],
    ['a sub-bin the load never reaches', bays(), sub([{ layerId: 'B-0412', moisturePercent: 30 }, { layerId: 'B-0419', moisturePercent: 33 }], 1200)],
    ['a reading of 100%', bays(), sub([{ layerId: 'B-0412', moisturePercent: 100 }])],
    ['a sub-bin order on a mix bin', bays(), sub([{ layerId: 'B-0412', moisturePercent: 10 }]), 'pro_rata'],
    ['a non-positive draw', bays(), { kind: 'wet', wetKg: 0, moisturePercent: 10 }],
    ['a draw below one gram of dry biochar', [layer('blend', '1', '9')], { kind: 'wet', wetKg: 0.001, moisturePercent: 0 }],
    ['a ledger invariant no larger bin would fix', [{ ...layer('broken', '10'), remainingDryBiocharKg: '11' }], { kind: 'wet', wetKg: 1, moisturePercent: 0 }],
  ])('classifies %s as invalid_request', (_label, layers, request, policy) => {
    expect(classify(refusal(layers, request, policy))).toEqual({ kind: 'invalid_request' });
    expect(classify(refusal(layers, request, policy), true)).toEqual({ kind: 'invalid_request' });
  });
});
