import { and, eq, inArray } from 'drizzle-orm';
import type { DbTransaction } from '@/db';
import { binMovements } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { requireOrgScope } from './utils';

/** Physical returns remain dependencies until exactly reversed, even after stock losses. */
export async function readActiveProductionRunReturns(
  ctx: OrgContext, reader: Pick<DbTransaction, 'select'>, runIds: readonly string[],
) {
  requireOrgScope(ctx);
  if (!runIds.length) return [];
  const history = await reader.select().from(binMovements).where(and(
    eq(binMovements.organizationId, ctx.organizationId),
    inArray(binMovements.sourceProductionRunId, [...runIds]),
    inArray(binMovements.movementType, ['failed_run_return', 'failed_run_return_reversal']),
  ));
  const reversed = new Set(history.filter(row => row.movementType === 'failed_run_return_reversal').map(row => row.correctsMovementId));
  return history.filter(row => row.movementType === 'failed_run_return' && !reversed.has(row.id));
}
