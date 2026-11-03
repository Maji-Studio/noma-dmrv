import { expect, it, vi } from 'vitest';
import { feedstockBinMethodChanges, storageLocations } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('@/db', () => ({ db: { transaction: mocks.transaction } }));
import { deleteStorageLocation } from './storage-locations';
it('gives the normal delete refusal when only method history references the bin', async () => {
  const remove = vi.fn();
  const tx = { delete: remove, select: () => ({ from: (table: unknown) => ({ where: () => {
    const rows = table === storageLocations ? [{ version: 1 }] : [{ value: table === feedstockBinMethodChanges ? 1 : 0 }];
    return Object.assign(Promise.resolve(rows), { for: async () => rows });
  } }) }) };
  mocks.transaction.mockImplementation((work: (reader: typeof tx) => unknown) => work(tx));
  await expect(deleteStorageLocation({ organizationId: 'org', userId: 'user' } as OrgContext, 'bin', 1))
    .rejects.toThrow('Cannot delete this storage bin while it has feedstock draw method history. Move or remove those records first.');
  expect(remove).not.toHaveBeenCalled();
});
