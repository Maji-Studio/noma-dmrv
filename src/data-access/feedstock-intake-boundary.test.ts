import { expect, it, vi } from 'vitest';
import type { DbTransaction } from '@/db';
import type { OrgContext } from '@/lib/auth/server';
const mocks = vi.hoisted(() => ({ history: vi.fn() }));
vi.mock('@/db', () => ({ db: {} }));
vi.mock('./feedstock-bin-method-history', () => ({ getFeedstockMethodChanges: mocks.history }));
vi.mock('./output-stock-dates', () => ({ getOutputStockFacilityTimezone: async () => 'Africa/Dar_es_Salaam' }));
import { assertFeedstockAdditionAfterSplit } from './feedstock-intake-boundary';
it('compares delivery day start in the facility zone to the split instant', async () => {
  mocks.history.mockResolvedValue([{ previousStockMode: 'mix', stockMode: 'split', effectiveAt: '2026-01-01T22:00:00.000Z' }]);
  const ctx = { organizationId: 'org', userId: 'user' } as OrgContext;
  const tx = {} as DbTransaction;
  const bin = { id: 'bin', facilityId: 'facility' };
  await expect(assertFeedstockAdditionAfterSplit(ctx, tx, bin, new Date('2026-01-02T00:00:00Z'))).rejects.toThrow(/In order.*Jan 2, 2026/);
  await expect(assertFeedstockAdditionAfterSplit(ctx, tx, bin, new Date('2026-01-03T00:00:00Z'))).resolves.toBeUndefined();
  mocks.history.mockResolvedValue([{ previousStockMode: 'split', stockMode: 'split', effectiveAt: '2026-01-10T22:00:00.000Z' }]);
  await expect(assertFeedstockAdditionAfterSplit(ctx, tx, bin, new Date('2026-01-02T00:00:00Z'))).resolves.toBeUndefined();
});
