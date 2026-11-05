import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('./runner', () => ({ runOperationInProcess: mocks.run }));
vi.mock('./output-stock', () => ({ recordOutputStockMovement: {} }));

import { correctOutputStockEntry, deleteOutputStockLoss } from './output-stock-form-edits';

const ctx = { organizationId: 'org', userId: 'user', orgRole: 'admin' as const, isPlatformAdmin: false };
const input = {
  storageLocationId: '00000000-0000-4000-8000-000000000001', facilityId: '00000000-0000-4000-8000-000000000002',
  correctsMovementId: '00000000-0000-4000-8000-000000000003', occurredAt: '2026-09-14T12:00:00.000Z',
  kind: 'delivery' as const, wetMassKg: 10, moisturePercent: 20, reason: 'Wrong reading',
  expectedProductVersions: {}, basisFingerprint: 'basis', idempotencyKey: 'key',
};

beforeEach(() => vi.clearAllMocks());

it('refuses delivery corrections at the stock form boundary before opening a transaction', async () => {
  await expect(correctOutputStockEntry(ctx, input)).rejects.toThrow('Choose a Lost mass entry to edit.');
  expect(mocks.run).not.toHaveBeenCalled();
});

afterEach(() => vi.unstubAllEnvs());

it('refuses Lost mass corrections and deletions at the operation boundary while off', async () => {
  vi.stubEnv('STOCK_ADJUSTMENTS_ENABLED', 'false');
  const expected = { code: 'conflict', message: 'Lost mass and stock counts are turned off on this server.' };
  await expect(correctOutputStockEntry(ctx, { ...input, kind: 'loss' })).rejects.toMatchObject(expected);
  // The disabled gate runs before transaction access, including direct operation calls.
  await expect(deleteOutputStockLoss.execute({ ctx } as Parameters<typeof deleteOutputStockLoss.execute>[0], {
    storageLocationId: input.storageLocationId, correctsMovementId: input.correctsMovementId, idempotencyKey: 'key', reason: 'Wrong reading',
  })).rejects.toMatchObject(expected);
  expect(mocks.run).not.toHaveBeenCalled();
});
