import { AsyncLocalStorage } from 'node:async_hooks';
import type { OrgContext } from '@/lib/auth/server';
import { SafeError } from '@/lib/errors';

const sentRecalculation = new AsyncLocalStorage<string>();

/** CLI-only exception explicitly requested for pre-production recalculation. Never exposed by an operation. */
export function withSentFeedstockRecalculation<T>(ctx: OrgContext, work: () => Promise<T>): Promise<T> {
  if (!ctx.isPlatformAdmin || !['development', 'test'].includes(process.env.NODE_ENV ?? ''))
    throw new SafeError('Recalculating Sent feedstock allocations requires a Platform Admin outside production.');
  return sentRecalculation.run(ctx.organizationId, work);
}

export function sentFeedstockRecalculationAllowed(ctx: OrgContext): boolean {
  return ctx.isPlatformAdmin && ['development', 'test'].includes(process.env.NODE_ENV ?? '') && sentRecalculation.getStore() === ctx.organizationId;
}
