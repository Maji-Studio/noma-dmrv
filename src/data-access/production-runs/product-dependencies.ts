import type { DbTransaction } from "@/db";
import {
  binMovements,
  biocharProductSourceAllocations,
  biocharProducts,
  outputStockAllocations,
  outputStockRunAllocations,
  productionRuns,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { SafeError } from '@/lib/errors';
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { requireOrgScope } from "../utils";

/**
 * Find one product whose immutable source provenance includes this run.
 *
 * Allocation rows are authoritative for bin-sourced products. The legacy
 * single-run column remains a fallback only for products without a source bin.
 */
export async function getProductionRunDependentProduct(
  ctx: OrgContext,
  tx: DbTransaction,
  productionRunId: string,
): Promise<{ id: string; code: string } | undefined> {
  requireOrgScope(ctx);
  const [count] = await tx.select({ reason: binMovements.reason, date: binMovements.physicalDate }).from(binMovements)
    .innerJoin(productionRuns, and(eq(productionRuns.organizationId, ctx.organizationId), eq(productionRuns.id, productionRunId), eq(productionRuns.biocharStorageLocationId, binMovements.storageLocationId)))
    .where(and(eq(binMovements.organizationId, ctx.organizationId), sql`(${binMovements.outputKind} = 'count' or ${binMovements.inputSnapshot}->>'kind' = 'count')`,
      sql`(${productionRuns.endTime} is null or ${productionRuns.endTime}::date <= ${binMovements.physicalDate})`, sql`${productionRuns.createdAt} <= ${binMovements.createdAt}`)).limit(1);
  if (count) throw new SafeError(`Production stock is covered by count: ${count.reason} (${count.date}).`);
  const [effect] = await tx.select({ kind: binMovements.outputKind, reason: binMovements.reason, date: binMovements.physicalDate })
    .from(outputStockRunAllocations)
    .innerJoin(outputStockAllocations, and(eq(outputStockAllocations.organizationId, ctx.organizationId), eq(outputStockAllocations.id, outputStockRunAllocations.allocationId)))
    .innerJoin(binMovements, and(eq(binMovements.organizationId, ctx.organizationId), eq(binMovements.id, outputStockAllocations.movementId)))
    .where(and(eq(outputStockRunAllocations.organizationId, ctx.organizationId), eq(outputStockRunAllocations.productionRunId, productionRunId))).limit(1);
  if (effect) throw new SafeError(`Production stock is used by ${effect.kind}: ${effect.reason} (${effect.date}).`);
  const [product] = await tx
    .select({ id: biocharProducts.id, code: biocharProducts.code })
    .from(biocharProducts)
    .leftJoin(
      biocharProductSourceAllocations,
      and(
        eq(
          biocharProductSourceAllocations.biocharProductId,
          biocharProducts.id,
        ),
        eq(
          biocharProductSourceAllocations.organizationId,
          ctx.organizationId,
        ),
      ),
    )
    .where(
      and(
        or(
          eq(
            biocharProductSourceAllocations.productionRunId,
            productionRunId,
          ),
          and(
            isNull(biocharProducts.sourceBiocharStorageLocationId),
            eq(
              biocharProducts.linkedProductionRunId,
              productionRunId,
            ),
          ),
        ),
        eq(biocharProducts.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);

  return product;
}

/** Ordinary metadata edits remain possible after an output observation. */
export async function assertProductionRunOutputBasisChange(ctx: OrgContext, tx: DbTransaction, productionRunId: string, previous: object, next: object): Promise<void> {
  requireOrgScope(ctx);
  const before = new Map(Object.entries(previous));
  const after = new Map(Object.entries(next));
  const changed = ['status', 'startTime', 'endTime', 'facilityId', 'reactorId', 'biocharStorageLocationId', 'biocharOutputKg', 'biocharMoisturePercent'].some(key => {
    const oldValue = before.get(key);
    const newValue = after.get(key);
    return newValue !== undefined && (newValue instanceof Date ? newValue.getTime() : newValue) !== (oldValue instanceof Date ? oldValue.getTime() : oldValue);
  });
  if (changed) {
    const dependent = await getProductionRunDependentProduct(ctx, tx, productionRunId);
    if (dependent) throw new SafeError(`Production stock is used by product ${dependent.code}.`);
  }
}
