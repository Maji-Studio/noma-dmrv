import { and, eq, inArray, isNotNull, ne, notInArray } from 'drizzle-orm';
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
    .where(and(eq(outputStockAllocations.organizationId, ctx.organizationId), deletedProductReversalConditions()));
}

/** Deletion evidence shared by live predicates and historical placement rows. */
export function deletedProductReversals(ctx: OrgContext, tx: Pick<DbTransaction, 'select'>, productIds: string[]) {
  requireOrgScope(ctx);
  return tx.select({ id: outputStockAllocations.targetBiocharProductId, movement: binMovements }).from(outputStockAllocations)
    .innerJoin(binMovements, and(eq(binMovements.organizationId, ctx.organizationId), eq(binMovements.id, outputStockAllocations.movementId)))
    .where(and(eq(outputStockAllocations.organizationId, ctx.organizationId), deletedProductReversalConditions(), inArray(outputStockAllocations.targetBiocharProductId, productIds)));
}

function deletedProductReversalConditions() {
  return and(isNotNull(outputStockAllocations.targetBiocharProductId), eq(binMovements.outputKind, 'reversal'));
}

interface MovementFact {
  id: string;
  outputKind: string | null;
  correctsMovementId: string | null;
}

/** Use the complete movement set, including reversals, before selecting live effects. */
export function liveOutputMovementPredicate(movements: readonly MovementFact[]) {
  const reversed = new Set(movements.filter(movement => movement.outputKind === 'reversal').map(movement => movement.correctsMovementId));
  return (movement: MovementFact) => movement.outputKind !== 'reversal' && !reversed.has(movement.id);
}
