import { expect, it, vi } from 'vitest';
import type { DbTransaction } from '@/db';
import type { OrgContext } from '@/lib/auth/server';
const mocks = vi.hoisted(() => ({ basis: vi.fn(), stock: vi.fn() }));
vi.mock('@/db', () => ({ db: {} }));
vi.mock('../ingredient-moisture-basis', () => ({ getIngredientMoistureBasis: mocks.basis }));
vi.mock('../lane-stock-derivation', () => ({ deriveLaneStock: mocks.stock }));
vi.mock('../output-stock-active-movements', () => ({ deletedProductIds: () => [] }));
import { getStorageLocationById } from './storage-locations';
import { getEntityById } from './index';

it('returns the requested draw moisture through the existing storage entity adapter', async () => {
  const row = { id: 'bin', code: 'B1', name: 'Bin', type: 'feedstock_bin', totalStoredWetKg: 200, pendingStoredWetKg: 0 };
  const select = () => {
    const query = { from: () => query, where: () => query, innerJoin: () => query, leftJoin: () => query,
      groupBy: () => query, as: () => ({}), limit: async () => [row] };
    return query;
  };
  const reader = { select } as unknown as DbTransaction;
  const ctx = { organizationId: 'org', userId: 'user' } as OrgContext;
  mocks.stock.mockResolvedValue([{ feedstockStockWetKg: 200, feedstockEstimatedDryKg: 180 }]);
  mocks.basis.mockResolvedValue({ wetMassKg: 30, dryMassKg: 24, moisturePercent: 20 });
  const at = '2026-01-01T12:00:00Z';
  expect(await getStorageLocationById(ctx, 'bin', reader, at, { excludeProductId: 'product', drawWetKg: 30 }))
    .toMatchObject({ mass: { moisturePercent: 20 } });
  expect(mocks.basis).toHaveBeenCalledWith(ctx, 'bin', at, reader, 'product', 30);
});

it('the entity dispatcher forwards all ingredient parameters to the adapter', async () => {
  const { db } = await import('@/db');
  const select = vi.fn(() => {
    const query = { from: () => query, where: () => query, innerJoin: () => query, leftJoin: () => query,
      groupBy: () => query, as: () => ({}), limit: async () => [{ id: 'bin', code: 'B1', name: 'Bin', type: 'feedstock_bin', pendingStoredWetKg: 0 }] };
    return query;
  });
  Object.assign(db, { select });
  const ctx = { organizationId: 'org', userId: 'user' } as OrgContext;
  mocks.stock.mockResolvedValue([{ feedstockStockWetKg: 200, feedstockEstimatedDryKg: 180 }]);
  mocks.basis.mockResolvedValue({ wetMassKg: 30, dryMassKg: 24, moisturePercent: 20 });
  const at = '2026-01-01T12:00:00Z';
  expect(await getEntityById(ctx, 'storageLocation', 'bin', { occurredAt: at, drawWetKg: 30, excludeProductId: 'product' }))
    .toMatchObject({ mass: { moisturePercent: 20 } });
  expect(mocks.basis).toHaveBeenLastCalledWith(ctx, 'bin', at, db, 'product', 30);
});
