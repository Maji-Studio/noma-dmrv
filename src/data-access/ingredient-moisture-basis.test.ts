import { describe, expect, it, vi } from 'vitest';
import type { DbTransaction } from '@/db';
import type { OrgContext } from '@/lib/auth/server';
import { getIngredientMoistureBasis } from './ingredient-moisture-basis';
import { resolveCompositionIngredientMassBasis } from './biochar-product-composition';

const ctx: OrgContext = { organizationId: 'org', userId: 'user', orgRole: 'owner', isPlatformAdmin: false };
function reader(intakes: unknown[], products: unknown[] = [], draws: unknown[] = [], movements: unknown[] = []) {
  const results = [intakes, products, draws, movements];
  return { select: vi.fn(() => {
    const rows = results.shift();
    const query = { from: () => query, innerJoin: () => query, where: () => Promise.resolve(rows) };
    return query;
  }) } as unknown as DbTransaction;
}
const priorDraw = { composition: { ingredients: [{ storageLocationId: 'bin', massKg: 50, massDryKg: 40 }] } };
const ingredient = { formulationIngredientId: 'line', feedstockTypeId: 'type', storageLocationId: 'bin', massKg: 30 };
const mixedReader = () => reader([{ wet: 100, dry: 80 }, { wet: 100, dry: 100 }], [priorDraw]);

describe('remaining ingredient moisture', () => {
  it('subtracts the saved withdrawal before weighting the remaining pile', async () => {
    const basis = await getIngredientMoistureBasis(ctx, 'bin', undefined, mixedReader());
    expect(basis).toMatchObject({ wetMassKg: 150, dryMassKg: 140 });
    expect(basis?.moisturePercent).toBeCloseTo(100 / 15);
    const result = await resolveCompositionIngredientMassBasis(ctx, mixedReader(), { ingredients: [ingredient] });
    expect(result.ingredients).toEqual([expect.objectContaining({ massDryKg: 28, moistureSource: 'weighted_remaining',
      moistureSourceSnapshot: { kind: 'weighted_remaining', wetMassKg: 150, dryMassKg: 140 } })]);
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
    const basis = await getIngredientMoistureBasis(ctx, 'bin', undefined, reader([{ wet: 100, dry: 80 }], [], [{ wet: 20, moisture: 20 }], [{ wet: -10, moisture: null }]));
    expect(basis).toMatchObject({ wetMassKg: 70, dryMassKg: 56, moisturePercent: 20 });
  });
});
