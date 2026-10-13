import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), post: vi.fn() }));
vi.mock('@/db', () => ({ db: { transaction: mocks.transaction } }));
vi.mock('./output-stock-post', () => ({ recordOutputStockMovementInTransaction: mocks.post }));

import { correctOutputStockEntry } from './output-stock-form-edits';

const ctx = { organizationId: 'org', userId: 'user', orgRole: 'owner' as const, isPlatformAdmin: false };
const input = {
  storageLocationId: '00000000-0000-4000-8000-000000000001', facilityId: '00000000-0000-4000-8000-000000000002',
  correctsMovementId: '00000000-0000-4000-8000-000000000003', occurredAt: '2026-09-14T12:00:00.000Z',
  kind: 'delivery' as const, wetMassKg: 10, moisturePercent: 20, reason: 'Wrong reading',
  expectedProductVersions: {}, basisFingerprint: 'basis', idempotencyKey: 'key',
};

beforeEach(() => vi.clearAllMocks());

it('refuses delivery corrections at the stock form boundary before opening a transaction', async () => {
  await expect(correctOutputStockEntry(ctx, input)).rejects.toThrow('Choose a Lost mass entry to edit.');
  expect(mocks.transaction).not.toHaveBeenCalled();
  expect(mocks.post).not.toHaveBeenCalled();
});
