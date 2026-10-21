import { describe, expect, it } from 'vitest';
import { decimal, storeRational } from './exact';
import { projectMoistureBases } from './layer-projection';
import { estimateStock, estimateStockExact, movementReestimates, movementReestimatedLayers, planWetRemovals, withMovement, type LayerMoistureBasis } from './moisture-estimate';
import { planOutputStock, type OutputStockLayer } from './planner';
import { resolveDrawPolicy, stockModeAt, type OutputStockMode, type StockModeChange } from './stock-mode';

const PLACED = '2026-09-01T12:00:00.000Z';
const DRAW = '2026-09-10T12:00:00.000Z';
const MERGE = '2026-09-05T12:00:00.000Z';
const SPLIT = '2026-09-15T12:00:00.000Z';
const SEQUENCE = BigInt(4);

function fixture(wetKg: number, mode: OutputStockMode, changes: StockModeChange[] = []) {
  const stocks: OutputStockLayer[] = ['a', 'b'].map((id, i) => ({ id, placedAt: PLACED, postingSequence: BigInt(i + 1),
    establishedDryBiocharKg: '80', ingredientDrySolidsKg: '0', remainingDryBiocharKg: '80', remainingSolidsKg: decimal(80),
    runs: [{ productionRunId: id, establishedDryKg: '80', remainingDryKg: '80' }] }));
  const recordedWetKg = new Map([['a', '100'], ['b', '200']]);
  const stockMode = stockModeAt(mode, changes, DRAW);
  const plan = planOutputStock(stocks, DRAW, { kind: 'wet', wetKg, moisturePercent: 50 }, resolveDrawPolicy(stockMode, 'oldest_first'));
  const bases: LayerMoistureBasis[] = plan.remainingLayers.map(layer => ({ layerId: layer.id, placedAt: PLACED,
    remainingSolidsKg: layer.remainingSolidsKg!, readings: [], removals: [],
    recorded: { solidsKg: decimal(80), wetKg: decimal(recordedWetKg.get(layer.id)!) } }));
  const preview = withMovement(bases, { readings: [], removals: planWetRemovals(plan) }, DRAW, SEQUENCE, 'loss', stockMode);
  const persisted = projectMoistureBases(plan.remainingLayers, { stockMode: mode, modeChanges: changes, recordedWetKg,
    readings: [], reversedMovementIds: new Set(), removals: plan.allocations.map(a => ({ layerId: a.layerId,
      movementId: 'draw', wetMassKg: '0', wetShareKg: storeRational(a.wetShareKg!), solidsKg: storeRational(a.solidsKg),
      reversesAllocationId: null, sequence: SEQUENCE, moisturePercent: 50, occurredAt: new Date(DRAW), kind: 'loss' })) });
  expect(estimateStockExact(persisted, DRAW)).toEqual(estimateStockExact(preview, DRAW));
  return [preview, persisted];
}

describe('removal re-estimates the physical pile', () => {
  it('keeps 200 kg wet when only an accounting layer falls below solids', () => {
    for (const bases of fixture(100, 'mix')) {
      expect(estimateStockExact(bases, DRAW).wetKg).toEqual(decimal(200));
      expect(movementReestimates(bases, DRAW, SEQUENCE)).toBe(false);
      expect(estimateStock(bases, DRAW, new Set(['a'])).wetKg).toBe(50);
      expect(estimateStock(bases, DRAW, new Set(['b'])).wetKg).toBe(150);
    }
  });

  it('re-estimates every mix layer when the pile crosses, including the layer that did not cross alone', () => {
    // 300 - 290 = 10 wet, 160 - 145 = 15 solids. Both layers reset to 7.5 / 0.5 = 15 wet.
    for (const bases of fixture(290, 'mix')) {
      expect(estimateStockExact(bases, DRAW).wetKg).toEqual(decimal(30));
      expect(movementReestimates(bases, DRAW, SEQUENCE)).toBe(true);
      for (const id of ['a', 'b']) expect(estimateStock(bases, DRAW, new Set([id]))).toMatchObject({
        wetKg: 15, moisturePercent: 50, basis: { source: 'draw', at: DRAW, kind: 'loss' },
      });
    }
  });

  it('re-estimates only the drawn sub-bin in split mode', () => {
    for (const bases of fixture(50, 'split')) {
      expect(estimateStock(bases, DRAW, new Set(['a'])).wetKg).toBe(110);
      expect(estimateStock(bases, DRAW, new Set(['b']))).toMatchObject({ wetKg: 200, basis: { source: 'recorded', at: PLACED } });
      expect(estimateStock(bases, DRAW).wetKg).toBe(310);
    }
  });

  it('keeps a mix removal in its historical mode after a switch to split', () => {
    const bases = fixture(100, 'split', [{ to: 'mix', at: MERGE, sequence: BigInt(3) }, { to: 'split', at: SPLIT, sequence: BigInt(5) }]);
    expect(estimateStock(bases[1], DRAW).wetKg).toBe(200);
  });

  it('keeps a removal before the merge split even though the bin is now mixed', () => {
    const bases = fixture(50, 'mix', [{ to: 'mix', at: SPLIT, sequence: BigInt(5) }]);
    expect(estimateStock(bases[1], DRAW).wetKg).toBe(310);
  });
});


it('keeps an emptied layer in the replay context of an earlier mixed draw', () => {
  const [bases] = fixture(100, 'mix');
  const after = withMovement(bases.map(b => b.layerId === 'b' ? { ...b, remainingSolidsKg: decimal(0) } : b),
    { readings: [], removals: [{ layerId: 'b', wetKg: decimal(110), solidsKg: decimal(0), moisturePercent: 50 }] },
    SPLIT, BigInt(5), 'loss', 'split');
  // The surviving layer kept 50 wet at the earlier mix posting, even though its sibling is now empty.
  expect(estimateStockExact(after, SPLIT).wetKg).toEqual(decimal(50));
});

it('lets a later posted count replace the whole pile re-estimate, even when backdated', () => {
  const [bases] = fixture(290, 'mix');
  const after = withMovement(bases, { removals: [], readings: bases.map(b => ({ layerId: b.layerId,
    solidsKg: b.remainingSolidsKg, moisturePercent: 25 })) }, MERGE, BigInt(5), 'count', 'mix');
  expect(estimateStock(after, DRAW)).toMatchObject({ wetKg: 20, moisturePercent: 25, basis: { source: 'reading', at: MERGE } });
});


it('checks unallocated intake in a reduced-loss correction of a mix pile', () => {
  const bases: LayerMoistureBasis[] = [
    { layerId: 'a', placedAt: PLACED, recordedAt: PLACED, remainingSolidsKg: decimal(65),
      recorded: { wetKg: decimal(100), solidsKg: decimal(80) }, readings: [], removals: [] },
    { layerId: 'b', placedAt: PLACED, recordedAt: MERGE, remainingSolidsKg: decimal(80),
      recorded: { wetKg: decimal(200), solidsKg: decimal(80) }, readings: [], removals: [] },
  ];
  // The original 50 kg / 50% loss is reversed. Its correction keeps only A.
  const after = withMovement(bases, { readings: [], removals: [{ layerId: 'a', wetKg: decimal(60), solidsKg: decimal(65), moisturePercent: 75 }] },
    DRAW, SEQUENCE, 'loss', 'mix');
  expect(estimateStockExact(after, DRAW).wetKg).toEqual(decimal(240));
  expect(estimateStockExact(after, DRAW).solidsKg).toEqual(decimal(145));
  expect(movementReestimatedLayers(after, DRAW, SEQUENCE)).toEqual([]);
  const persisted = projectMoistureBases(bases.map(b => ({ id: b.layerId, placedAt: b.placedAt, postingSequence: BigInt(1),
    establishedDryBiocharKg: '80', ingredientDrySolidsKg: '0', remainingDryBiocharKg: b.layerId === 'a' ? '65' : '80',
    remainingSolidsKg: b.remainingSolidsKg, runs: [] })), {
    stockMode: 'mix', recordedWetKg: new Map([['a', '100'], ['b', '200']]), readings: [], reversedMovementIds: new Set(['original']),
    removals: [
      { layerId: 'a', movementId: 'original', sequence: BigInt(2), wetMassKg: '50', solidsKg: storeRational(decimal(25)),
        moisturePercent: 50, occurredAt: new Date(DRAW), kind: 'loss', reversesAllocationId: null },
      { layerId: 'a', movementId: 'correction', sequence: SEQUENCE, wetMassKg: '60', solidsKg: storeRational(decimal(15)),
        moisturePercent: 75, occurredAt: new Date(DRAW), kind: 'loss', reversesAllocationId: null },
    ],
  });
  expect(estimateStockExact(persisted, DRAW)).toEqual(estimateStockExact(after, DRAW));
});

it('reports only the split layer re-estimated at this posting and its own reading', () => {
  const [bases] = fixture(50, 'split');
  expect(movementReestimatedLayers(bases, DRAW, SEQUENCE)).toEqual([
    { layerId: 'a', moisturePercent: 50, stayWetKg: 110, staySolidsKg: 55 },
  ]);
});

it('does not include an intake posted after a historical mix draw', () => {
  const [bases] = fixture(50, 'split');
  const mixed = bases.map(b => ({ ...b, recordedAt: b.layerId === 'b' ? SPLIT : PLACED,
    removals: b.removals.map(r => ({ ...r, stockMode: 'mix' as const, postedAt: DRAW })) }));
  expect(movementReestimatedLayers(mixed, DRAW, SEQUENCE)).toEqual([
    { layerId: 'a', moisturePercent: 50, stayWetKg: 110, staySolidsKg: 55 },
  ]);
});


it('retains distinct readings when several split sub-bins re-estimate together', () => {
  const bases: LayerMoistureBasis[] = ['a', 'b'].map(layerId => ({ layerId, placedAt: PLACED,
    recorded: { wetKg: decimal(100), solidsKg: decimal(80) }, remainingSolidsKg: decimal(layerId === 'a' ? 55 : 65), readings: [], removals: [] }));
  const after = withMovement(bases, { readings: [], removals: [
    { layerId: 'a', wetKg: decimal(50), solidsKg: decimal(55), moisturePercent: 50 },
    { layerId: 'b', wetKg: decimal(60), solidsKg: decimal(65), moisturePercent: 75 },
  ] }, DRAW, SEQUENCE, 'loss', 'split');
  expect(movementReestimatedLayers(after, DRAW, SEQUENCE)).toEqual([
    { layerId: 'a', moisturePercent: 50, stayWetKg: 110, staySolidsKg: 55 },
    { layerId: 'b', moisturePercent: 75, stayWetKg: 260, staySolidsKg: 65 },
  ]);
});
