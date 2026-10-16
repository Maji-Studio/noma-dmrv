import { and, eq, isNotNull, ne, notInArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { DbTransaction } from '@/db';
import { binMovements, outputStockAllocations } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { requireOrgScope } from './utils';

/** Reversals and the effects they cancel are history, never live consumers. */
export function activeOutputMovement(ctx: OrgContext, tx: Pick<DbTransaction, 'select'>) {
  requireOrgScope(ctx);
  const reversals = alias(binMovements, 'reversals');
  return and(ne(binMovements.outputKind, 'reversal'), notInArray(binMovements.id,
    tx.select({ id: reversals.correctsMovementId }).from(reversals).where(and(
      eq(reversals.organizationId, ctx.organizationId), eq(reversals.outputKind, 'reversal'), isNotNull(reversals.correctsMovementId),
    ))));
}

/** Deleted products retain their placement facts but never become stock again on facility restore. */
export function deletedProductIds(ctx: OrgContext, tx: Pick<DbTransaction, 'select'>) {
  requireOrgScope(ctx);
  return tx.select({ id: outputStockAllocations.targetBiocharProductId }).from(outputStockAllocations)
    .innerJoin(binMovements, and(eq(binMovements.organizationId, ctx.organizationId), eq(binMovements.id, outputStockAllocations.movementId)))
    .where(and(eq(outputStockAllocations.organizationId, ctx.organizationId), isNotNull(outputStockAllocations.targetBiocharProductId), eq(binMovements.outputKind, 'reversal')));
}
