import { describe, expect, it, vi } from 'vitest';
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

const ctx: OrgContext = { organizationId: 'org', userId: 'user', orgRole: 'owner', isPlatformAdmin: false };
function reader(intakes: unknown[], products: unknown[] = [], draws: unknown[] = [], movements: unknown[] = [], conditions: SQL[] = []) {
  const results = [intakes, products, draws, movements];
  return { select: vi.fn(() => {
    const rows = results.shift();
    const query = { from: () => query, innerJoin: () => query, where: (condition: SQL) => { conditions.push(condition); return Promise.resolve(rows); } };
    return query;
  }) } as unknown as DbTransaction;
}
const priorDraw = { composition: { ingredients: [{ storageLocationId: 'bin', massKg: 50, massDryKg: 40 }] } };
const ingredient = { formulationIngredientId: 'line', feedstockTypeId: 'type', storageLocationId: 'bin', massKg: 30 };
const mixedReader = () => reader([{ wet: 100, dry: 80 }, { wet: 100, dry: 100 }], [priorDraw]);

describe('remaining ingredient moisture', () => {
  it('withdraws wet stock pro rata without using a product override', async () => {
    const basis = await getIngredientMoistureBasis(ctx, 'bin', undefined, mixedReader());
    expect(basis).toMatchObject({ wetMassKg: 150, dryMassKg: 135 });
    expect(basis?.moisturePercent).toBe(10);
    const result = await resolveCompositionIngredientMassBasis(ctx, mixedReader(), { ingredients: [ingredient] });
    expect(result.ingredients).toEqual([expect.objectContaining({ massDryKg: 27, moistureSource: 'weighted_remaining',
      moistureSourceSnapshot: { kind: 'weighted_remaining', wetMassKg: 150, dryMassKg: 135 } })]);
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
    const parsed = updateProductionRunSchema.parse({
      productionRunId: '00000000-0000-4000-8000-000000000001', feedstockMoisturePercent: basis?.moisturePercent,
    });
    expect(parsed.feedstockMoisturePercent).toBe(basis?.moisturePercent);
    const result = await resolveCompositionIngredientMassBasis(ctx, reader([{ wet: 150, dry: 140 }]),
      { ingredients: [{ ...ingredient, massKg: 15000000 }] });
    expect(result.ingredients).toEqual([expect.objectContaining({ massDryKg: 14000000, moistureContentPercent: 6.666667 })]);
  });
  it('limits every physical stock input to the requested day and excludes archived intakes', async () => {
    const conditions: SQL[] = [];
    await getIngredientMoistureBasis(ctx, 'bin', '2026-09-14', reader([{ wet: 100, dry: 50 }], [], [], [], conditions), 'excluded-product');
    const queries = conditions.map(condition => new PgDialect().sqlToQuery(condition));
    expect(queries[0].sql).toContain('"feedstocks"."archived_at" is null');
    expect(queries[0].sql).toContain('"feedstocks"."delivery_date" <=');
    expect(queries[1].sql).toContain('"biochar_products"."placed_at" <=');
    expect(queries[1].params).toContain('excluded-product');
    expect(queries[2].sql).toContain('"production_runs"."start_time" <=');
    expect(queries[2].params).toContain('cancelled');
    expect(queries[3].sql).toContain('coalesce("bin_movements"."physical_date", "bin_movements"."created_at"::date) <=');
    for (const query of queries) expect(query.params).toContain('org');
    expect(queries[0].params).toContain('2026-09-14T23:59:59.999Z');
    expect(queries[1].params).toContain('2026-09-14');
    expect(queries[2].params).toContain('2026-09-14T23:59:59.999Z');
    expect(queries[3].params).toContain('2026-09-14');
  });
  it('keeps the same basis when fractional intake rows are returned in a different order', async () => {
    const intakes = [{ wet: 0.1, dry: 0.05 }, { wet: 0.2, dry: 0.1 }, { wet: 0.3, dry: 0.15 }];
    const first = await getIngredientMoistureBasis(ctx, 'bin', undefined, reader(intakes));
    const reordered = await getIngredientMoistureBasis(ctx, 'bin', undefined, reader([...intakes].reverse()));
    expect(first).toEqual({ wetMassKg: 0.6, dryMassKg: 0.3, moisturePercent: 50 });
    expect(reordered).toEqual(first);
  });
  it('retains an explicit override and freezes the saved basis on later reads', async () => {
    const result = await resolveCompositionIngredientMassBasis(ctx, mixedReader(), { ingredients: [{ ...ingredient, moistureContentPercent: 10, moistureSource: 'operator_override' }] });
    expect(result.ingredients).toEqual([expect.objectContaining({ massDryKg: 27, moistureContentPercent: 10, moistureSource: 'operator_override' })]);
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
    await expect(resolveCompositionIngredientMassBasis(ctx, reader([]), { ingredients: [ingredient] })).rejects.toThrow('requires moisture');
  });
  it('includes run withdrawals and wet movements without changing saved ingredient solids', async () => {
    const basis = await getIngredientMoistureBasis(ctx, 'bin', undefined, reader([{ wet: 100, dry: 80 }], [], [{ wet: 20, moisture: 0 }], [{ wet: -10, moisture: null }]));
    expect(basis).toMatchObject({ wetMassKg: 70, dryMassKg: 56, moisturePercent: 20 });
  });
});
