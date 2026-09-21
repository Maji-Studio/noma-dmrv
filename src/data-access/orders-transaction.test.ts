import { describe, expect, it, vi } from 'vitest';
import { db, type DbTransaction } from '@/db';
import type { OrgContext } from '@/lib/auth/server';
vi.mock('./certification-lineage-guards', () => ({ assertCanMutateCertifiedLineage: vi.fn() }));
vi.mock('./transport-legs', () => ({ lockBiocharTransportRouteTopology: vi.fn() }));
import { updateOrder } from './orders';
const ctx: OrgContext = { organizationId: 'org', userId: 'user', orgRole: 'owner', isPlatformAdmin: false };

describe('order transaction customer-location validation', () => {
  it.each(['customer', 'wrong-customer', null])('uses the held transaction and enforces ownership: %s', async customerId => {
    const saved = { id: 'order', customerId: 'customer', customerLocationId: 'location' };
    const responses = [[saved], [], customerId == null ? [] : [{ customerId }]];
    const tx = { select: vi.fn(() => {
      const rows = responses.shift();
      const query = { from: () => query, where: () => query, for: () => query, then: (resolve: (rows: unknown) => unknown) => Promise.resolve(rows).then(resolve) };
      return query;
    }), update: vi.fn(() => ({ set: () => ({ where: () => ({ returning: async () => [saved] }) }) })) } as unknown as DbTransaction;
    vi.spyOn(db, 'transaction').mockImplementation(async callback => callback(tx));
    const globalRead = vi.spyOn(db, 'select').mockImplementation(() => { throw new Error('Global pool must not be used'); });
    const result = updateOrder(ctx, 'order', { code: 'renamed' });
    if (customerId === 'customer') await expect(result).resolves.toEqual(saved);
    else await expect(result).rejects.toThrow(customerId == null ? 'not found' : 'different customer');
    expect(globalRead).not.toHaveBeenCalled();
    if (customerId !== 'customer') expect(tx.update).not.toHaveBeenCalled();
  });
});
