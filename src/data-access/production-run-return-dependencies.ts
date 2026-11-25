import { activeReturns, RETURN_MOVEMENT_TYPES } from '@/lib/production-run-returns/active-returns';
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
    inArray(binMovements.movementType, [...RETURN_MOVEMENT_TYPES]),
  ));
  return activeReturns(history);
}
