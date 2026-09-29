import type { DbTransaction } from '@/db';
import { applicationOutputAllocations, outputStockAllocations } from '@/db/schema';
import { MIX_BIN_REMOVALS_CREDITABLE } from '@/config/output-stock';
import type { OrgContext } from '@/lib/auth/server';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { requireOrgScope } from './utils';

type Reader = Pick<DbTransaction, 'select'>;

/**
 * Applications held out of credit batches because their biochar was drawn
 * pro-rata from a mix bin: the delivery came from a mix product bin, or a
 * product in it was made from a mix biochar bin (ADR 0030). A pro-rata draw
 * that a correction reversed no longer counts. Empty while mix-bin removals
 * are creditable.
 */
export async function getMixBinHeldApplicationIds(ctx: OrgContext, reader: Reader, applicationIds: readonly string[]): Promise<Set<string>> {
  requireOrgScope(ctx);
  if (MIX_BIN_REMOVALS_CREDITABLE || !applicationIds.length) return new Set();
  const shares = await reader.select({ applicationId: applicationOutputAllocations.applicationId, deliveryId: applicationOutputAllocations.deliveryId, productId: applicationOutputAllocations.biocharProductId })
    .from(applicationOutputAllocations)
    .where(and(eq(applicationOutputAllocations.organizationId, ctx.organizationId), inArray(applicationOutputAllocations.applicationId, [...applicationIds])));
  if (!shares.length) return new Set();
  const deliveryIds = [...new Set(shares.map(s => s.deliveryId))];
  const productIds = [...new Set(shares.map(s => s.productId))];
  const draws = await reader.select({ id: outputStockAllocations.id, deliveryId: outputStockAllocations.deliveryId, productId: outputStockAllocations.targetBiocharProductId, reverses: outputStockAllocations.reversesAllocationId })
    .from(outputStockAllocations)
    .where(and(eq(outputStockAllocations.organizationId, ctx.organizationId),
      sql`${outputStockAllocations.basisSnapshot}->>'policy' = 'pro_rata'`,
      or(inArray(outputStockAllocations.deliveryId, deliveryIds), inArray(outputStockAllocations.targetBiocharProductId, productIds))));
  // Reversal rows copy the original's snapshot, so they arrive in the same read.
  const reversed = new Set(draws.flatMap(d => d.reverses ? [d.reverses] : []));
  const live = draws.filter(d => !d.reverses && !reversed.has(d.id));
  const mixDeliveries = new Set(live.flatMap(d => d.deliveryId ? [d.deliveryId] : []));
  const mixProducts = new Set(live.flatMap(d => d.productId ? [d.productId] : []));
  return new Set(shares.filter(s => mixDeliveries.has(s.deliveryId) || mixProducts.has(s.productId)).map(s => s.applicationId));
}
