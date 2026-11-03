import { afterEach, expect, it, vi } from 'vitest';
import { sentFeedstockRecalculationAllowed, withSentFeedstockRecalculation } from './feedstock-recalculation-policy';
const ctx = { userId: 'actor', organizationId: 'org', orgRole: 'admin' as const, isPlatformAdmin: true };
afterEach(() => vi.unstubAllEnvs());
it('refuses the exception in production, including bootstrap override', () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('ALLOW_DEV_BOOTSTRAP', '1');
  expect(() => withSentFeedstockRecalculation(ctx, async () => null)).toThrow(/outside production/);
  expect(sentFeedstockRecalculationAllowed(ctx)).toBe(false);
});
it('requires a Platform Admin and an explicit non-production environment', () => {
  vi.stubEnv('NODE_ENV', 'test');
  expect(() => withSentFeedstockRecalculation({ ...ctx, isPlatformAdmin: false }, async () => null)).toThrow(/Platform Admin/);
  vi.stubEnv('NODE_ENV', '');
  expect(() => withSentFeedstockRecalculation(ctx, async () => null)).toThrow(/outside production/);
});
it('confines the exception to this organization and asynchronous CLI call', async () => {
  vi.stubEnv('NODE_ENV', 'test');
  expect(sentFeedstockRecalculationAllowed(ctx)).toBe(false);
  await withSentFeedstockRecalculation(ctx, async () => {
    expect(sentFeedstockRecalculationAllowed(ctx)).toBe(true);
    expect(sentFeedstockRecalculationAllowed({ ...ctx, organizationId: 'other' })).toBe(false);
  });
  expect(sentFeedstockRecalculationAllowed(ctx)).toBe(false);
});
