import { describe, expect, it, vi } from 'vitest';
import { feedstocks, biocharProducts, productionRunFeedstockDraws, productionRunFeedstocks, binMovements, storageLocations, facilities } from '@/db/schema';
import type { DbTransaction } from '@/db';
import type { OrgContext } from '@/lib/auth/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { updateProductionRunSchema } from '@/schemas/production-runs';

vi.mock('@/db', () => ({ db: {} }));
vi.mock('./utils', () => ({ requireOrgScope: vi.fn() }));
vi.mock('./feedstock-wet-stock', () => ({ assertFeedstockWetDrawWithinStock: vi.fn() }));

import { getIngredientMoistureBasis } from './ingredient-moisture-basis';
import { resolveCompositionIngredientMassBasis } from './biochar-product-composition';

const ctx: OrgContext = { organizationId: 'org', userId: 'user', orgRole: 'admin', isPlatformAdmin: false };
const INTAKE_AT = new Date('2026-09-13T00:00:00.000Z');
const DRAW_AT = new Date('2026-09-14T10:00:00.000Z');
function reader(intakes: { wet: number; dry: number | null }[], products: unknown[] = [], draws: { wet: number; moisture?: number }[] = [], movements: { wet: number; moisture?: number | null; movementType?: string; correctsMovementId?: string }[] = [], conditions: SQL[] = [], stockMode = 'mix') {
  const results = new Map<unknown, unknown[]>([
    [storageLocations, [{ type: 'feedstock_bin', facilityId: 'facility', stockMode, drawOrder: 'oldest_first' }]],
    [facilities, [{ timezone: 'UTC' }]],
    [feedstocks, intakes.map((row, index) => ({ id: `intake-${index}`, wetKg: row.wet, dryKg: row.dry, deliveryDate: INTAKE_AT, createdAt: new Date(INTAKE_AT.getTime() + index), moisturePercent: null }))],
    [biocharProducts, products.map((row, index) => ({ ...row as object, id: `product-${index}`, placedAt: DRAW_AT, createdAt: DRAW_AT }))],
    [productionRunFeedstockDraws, draws.map((row, index) => ({ id: `draw-${index}`, sourceId: `run-${index}`, wetKg: row.wet, startTime: DRAW_AT, createdAt: DRAW_AT }))],
    [productionRunFeedstocks, draws.map((row, index) => ({ feedstockId: 'intake-0', productionRunId: `run-${index}`, wetKg: row.wet }))],
    [binMovements, movements.map((row, index) => ({ movement: { id: `movement-${index}`, massDeltaKg: row.wet, movementType: row.movementType ?? 'loss', correctsMovementId: row.correctsMovementId, occurredAt: DRAW_AT, createdAt: DRAW_AT, moistureRatioUsed: null }, actorName: null }))],
  ]);
  return { select: vi.fn(() => {
    let table: unknown;
    let predicate: SQL;
    const query = { from: (value: unknown) => { table = value; return query; }, innerJoin: () => query, leftJoin: () => query,
      where: (condition: SQL) => { predicate = condition; return query; },
      then: (resolve: (rows: unknown[]) => unknown) => {
        conditions.push(predicate);
        return Promise.resolve(results.get(table) ?? []).then(resolve);
      } };
    return query;
  }) } as unknown as DbTransaction;
}
const priorDraw = { composition: { ingredients: [{ storageLocationId: 'bin', massKg: 50, massDryKg: 40 }] } };
const ingredient = { formulationIngredientId: 'line', feedstockTypeId: 'type', storageLocationId: 'bin', massKg: 30 };
const mixedReader = () => reader([{ wet: 100, dry: 80 }, { wet: 100, dry: 100 }], [priorDraw]);

describe('remaining ingredient moisture', () => {
  it('withdraws wet stock pro rata and keeps the estimate beside the measured moisture', async () => {
    const basis = await getIngredientMoistureBasis(ctx, 'bin', undefined, mixedReader());
    expect(basis).toMatchObject({ wetMassKg: 150, dryMassKg: 135 });
    expect(basis?.moisturePercent).toBe(10);
    // The operator measured 20%; solids follow the reading, the 10% estimate is kept as what they saw.
    const result = await resolveCompositionIngredientMassBasis(ctx, mixedReader(), { ingredients: [{ ...ingredient, moistureContentPercent: 20 }] });
    expect(result.ingredients).toEqual([expect.objectContaining({ massDryKg: 24, moistureContentPercent: 20,
      moistureEstimate: { moisturePercent: 10, wetMassKg: 150, dryMassKg: 135 } })]);
  });
  it('keeps the original pile ratio after a zero-moisture product override', async () => {
    const basis = await getIngredientMoistureBasis(ctx, 'bin', undefined, reader(
      [{ wet: 100, dry: 50 }],
      [{ composition: { ingredients: [{ storageLocationId: 'bin', massKg: 20, massDryKg: 20, moistureContentPercent: 0 }] } }],
    ));
    expect(basis).toEqual({ wetMassKg: 80, dryMassKg: 40, moisturePercent: 50 });
  });
  it('round-trips repeating moisture through the production schema without rounding the solids ratio', async () => {
    const basis = await getIngredientMoistureBasis(ctx, 'bin', undefined, reader([{ wet: 150, dry: 140 }]));
    expect(basis?.moisturePercent).toBe(6.666667);
    const parsed = updateProductionRunSchema.parse({ expectedVersion: 1,
      productionRunId: '00000000-0000-4000-8000-000000000001', feedstockMoisturePercent: basis?.moisturePercent,
    });
    expect(parsed.feedstockMoisturePercent).toBe(basis?.moisturePercent);
    const result = await resolveCompositionIngredientMassBasis(ctx, reader([{ wet: 150, dry: 140 }]),
      { ingredients: [{ ...ingredient, massKg: 15000000, moistureContentPercent: basis?.moisturePercent }] });
    expect(result.ingredients).toEqual([expect.objectContaining({ massDryKg: 13999999.95, moistureContentPercent: 6.666667 })]);
  });
  it('limits physical stock to the requested instant and excludes the current product', async () => {
    const conditions: SQL[] = [];
    const stock = () => reader([{ wet: 100, dry: 50 }], [priorDraw], [{ wet: 10 }], [{ wet: -10 }], conditions);
    expect(await getIngredientMoistureBasis(ctx, 'bin', '2026-09-12T12:00:00.000Z', stock())).toBeNull();
    expect(await getIngredientMoistureBasis(ctx, 'bin', '2026-09-14T09:00:00.000Z', stock())).toMatchObject({ wetMassKg: 100, dryMassKg: 50 });
    expect(await getIngredientMoistureBasis(ctx, 'bin', '2026-09-14T12:00:00.000Z', stock(), 'product-0')).toMatchObject({ wetMassKg: 80, dryMassKg: 40 });
    expect(await getIngredientMoistureBasis(ctx, 'bin', '2026-09-14T12:00:00.000Z', stock())).toMatchObject({ wetMassKg: 30, dryMassKg: 15 });
    for (const condition of conditions) expect(new PgDialect().sqlToQuery(condition).params).toContain('org');
  });
  it('uses remaining delivery composition under Oldest first', async () => {
    const tx = reader([{ wet: 10, dry: 10 }, { wet: 10, dry: 5 }],
      [{ composition: { ingredients: [{ storageLocationId: 'bin', massKg: 10 }] } }], [], [], [], 'split');
    expect(await getIngredientMoistureBasis(ctx, 'bin', undefined, tx)).toEqual({ wetMassKg: 10, dryMassKg: 5, moisturePercent: 50 });
  });
  it('keeps the same basis when fractional intake rows are returned in a different order', async () => {
    const intakes = [{ wet: 0.1, dry: 0.05 }, { wet: 0.2, dry: 0.1 }, { wet: 0.3, dry: 0.15 }];
    const first = await getIngredientMoistureBasis(ctx, 'bin', undefined, reader(intakes));
    const reordered = await getIngredientMoistureBasis(ctx, 'bin', undefined, reader([...intakes].reverse()));
    expect(first).toEqual({ wetMassKg: 0.6, dryMassKg: 0.3, moisturePercent: 50 });
    expect(reordered).toEqual(first);
  });
  it('rounds dry solids half up in exact decimals, as the snapshot check does', async () => {
    // 1.005 × 0.7 is 0.7035 exactly (0.7034999… in floats); the database rounds it to 0.704.
    const result = await resolveCompositionIngredientMassBasis(ctx, mixedReader(), { ingredients: [{ ...ingredient, massKg: 1.005, moistureContentPercent: 30 }] });
    expect(result.ingredients).toEqual([expect.objectContaining({ massDryKg: 0.704 })]);
  });
  it('freezes the measured basis on later reads', async () => {
    const result = await resolveCompositionIngredientMassBasis(ctx, mixedReader(), { ingredients: [{ ...ingredient, moistureContentPercent: 10 }] });
    expect(result.ingredients).toEqual([expect.objectContaining({ massDryKg: 27, moistureContentPercent: 10 })]);
    const saved = await resolveCompositionIngredientMassBasis(ctx, reader([{ wet: 100, dry: 100 }]), { ingredients: [ingredient] }, result);
    expect(saved.ingredients).toEqual(result.ingredients);
  });
  it('keeps zero-mass lines at zero solids without reading a moisture basis', async () => {
    const tx = reader([]);
    const result = await resolveCompositionIngredientMassBasis(ctx, tx, { ingredients: [{ ...ingredient, massKg: 0 }] });
    expect(result.ingredients).toEqual([{ ...ingredient, massKg: 0, massDryKg: 0, moistureContentPercent: null }]);
    expect(tx.select).not.toHaveBeenCalled();
  });
  it('does not turn missing dry facts or an exhausted bin into a default', async () => {
    expect(await getIngredientMoistureBasis(ctx, 'bin', undefined, reader([{ wet: 100, dry: null }]))).toBeNull();
    expect(await getIngredientMoistureBasis(ctx, 'bin', undefined, reader([{ wet: 50, dry: 40 }], [priorDraw]))).toBeNull();
    // Without a reading nothing is inferred, even when the bin has an estimate.
    await expect(resolveCompositionIngredientMassBasis(ctx, mixedReader(), { ingredients: [ingredient] })).rejects.toThrow('measured moisture');
  });
  it('includes run withdrawals and wet movements without changing saved ingredient solids', async () => {
    const basis = await getIngredientMoistureBasis(ctx, 'bin', undefined, reader([{ wet: 100, dry: 80 }], [], [{ wet: 20, moisture: 0 }], [{ wet: -10, moisture: null }]));
    expect(basis).toMatchObject({ wetMassKg: 70, dryMassKg: 56, moisturePercent: 20 });
  });
});


it.each(['product', 'run', 'loss'])('a wetter %s withdrawal preserves the feedstock pile ratio', async kind => {
  // 50 kg at 50% carries 25 kg measured solids, but the bin's dry estimate
  // follows its original 80/100 ratio, never 80 minus the measured 25.
  const product = { composition: { ingredients: [{ storageLocationId: 'bin', massKg: 50, massDryKg: 25, moistureContentPercent: 50 }] } };
  const basis = await getIngredientMoistureBasis(ctx, 'bin', undefined, reader([{ wet: 100, dry: 80 }],
    kind === 'product' ? [product] : [], kind === 'run' ? [{ wet: 50, moisture: 50 }] : [], kind === 'loss' ? [{ wet: -50 }] : []));
  expect(basis).toEqual({ wetMassKg: 50, dryMassKg: 40, moisturePercent: 20 });
});


it('keeps a dry-stock ledger point for a reversed loss mid-history', async () => {
  const { replayFeedstockBinStock } = await import('./feedstock-bin-ledger');
  const tx = reader([{ wet: 100, dry: 80 }], [], [], [
    { wet: -20 }, { wet: 20, movementType: 'adjustment', correctsMovementId: 'movement-0' }, { wet: -10 },
  ]);
  const ledger = await replayFeedstockBinStock(ctx, 'bin', tx);
  expect(ledger.entries.find(entry => entry.id === 'movement-0')).toMatchObject({ reversed: true, afterWetKg: 100, estimatedDryKg: 80 });
  expect(ledger.entries.at(-1)).toMatchObject({ afterWetKg: 90, estimatedDryKg: 72 });
});
