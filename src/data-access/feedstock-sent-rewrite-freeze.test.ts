import { expect, it, vi } from 'vitest';
import type { DbTransaction } from '@/db';
import type { OrgContext } from '@/lib/auth/server';
vi.mock('@/db', () => ({ db: {} }));
const mocks = vi.hoisted(() => ({ owners: vi.fn(), targets: vi.fn() }));
vi.mock('./feedstock-transport-ownership', () => ({ getFeedstockTransportOwnerBatches: mocks.owners }));
vi.mock('./certification-lineage-guards', () => ({ getFeedstockLineageBatchTargets: mocks.targets }));
import { prepareFeedstockTransportOwnershipFreeze } from './feedstock-transport-ownership-freeze';
const ctx = { organizationId: 'org', userId: 'user' } as OrgContext;
it('only an explicit non-production rewrite skips the transport ownership freeze', async () => {
  const execute = vi.fn();
  const tx = { execute } as unknown as DbTransaction;
  const freeze = await prepareFeedstockTransportOwnershipFreeze(ctx, tx, ['intake'], { mutation: 'update', subject: 'production run' }, undefined, { allowSentRewrite: true });
  const write = vi.fn().mockResolvedValue('written');
  expect(await freeze(write)).toBe('written');
  expect(write).toHaveBeenCalledOnce();
  expect(execute).not.toHaveBeenCalled();
  expect(mocks.owners).not.toHaveBeenCalled();
  expect(mocks.targets).not.toHaveBeenCalled();
});
it('refuses the freeze override in production before writing', async () => {
  vi.stubEnv('NODE_ENV', 'production');
  try {
    await expect(prepareFeedstockTransportOwnershipFreeze(ctx, {} as DbTransaction, ['intake'], { mutation: 'update', subject: 'production run' }, undefined, { allowSentRewrite: true }))
      .rejects.toMatchObject({ code: 'forbidden' });
  } finally { vi.unstubAllEnvs(); }
});
