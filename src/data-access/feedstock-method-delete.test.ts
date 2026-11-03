import { expect, it, vi } from 'vitest';
import { feedstockBinMethodChanges, storageLocations } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('@/db', () => ({ db: { transaction: mocks.transaction } }));
import { deleteStorageLocation } from './storage-locations';
it('deletes method history before the otherwise unreferenced bin in the same transaction', async () => {
  const remove = vi.fn<(table: unknown) => { where: ReturnType<typeof vi.fn> }>(() => ({ where: vi.fn().mockResolvedValue(undefined) }));
  const tx = { delete: remove, select: () => ({ from: (table: unknown) => ({ where: () => {
    const rows = table === storageLocations ? [{ version: 1 }] : [{ value: table === feedstockBinMethodChanges ? 1 : 0 }];
    return Object.assign(Promise.resolve(rows), { for: async () => rows });
  } }) }) };
  mocks.transaction.mockImplementation((work: (reader: typeof tx) => unknown) => work(tx));
  await expect(deleteStorageLocation({ organizationId: 'org', userId: 'user' } as OrgContext, 'bin', 1))
    .resolves.toBeUndefined();
  expect(remove.mock.calls.map(call => call[0])).toEqual([feedstockBinMethodChanges, storageLocations]);
});

it('still refuses operational references without deleting method history', async () => {
  const remove = vi.fn();
  const tx = { delete: remove, select: () => ({ from: (table: unknown) => ({ where: () => {
    const rows = table === storageLocations ? [{ version: 1 }] : [{ value: 1 }];
    return Object.assign(Promise.resolve(rows), { for: async () => rows });
  } }) }) };
  mocks.transaction.mockImplementation((work: (reader: typeof tx) => unknown) => work(tx));
  await expect(deleteStorageLocation({ organizationId: 'org', userId: 'user' } as OrgContext, 'bin', 1))
    .rejects.toThrow(/Cannot delete this storage bin.*feedstock batches/);
  expect(remove).not.toHaveBeenCalled();
});
