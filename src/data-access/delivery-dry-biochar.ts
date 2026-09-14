import type { DbTransaction } from '@/db';
import { outputStockAllocations } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import { and, eq } from 'drizzle-orm';
import { requireOrgScope } from './utils';

/** Saved signed delivery effects are the sole authority; never infer from a product wet ratio. */
export async function deriveDeliveryDryBiocharKg(ctx: OrgContext, tx: DbTransaction, input: { deliveryId: string }): Promise<number> {
  requireOrgScope(ctx);
  const rows = await tx.select({ dry: outputStockAllocations.dryMassKg }).from(outputStockAllocations).where(and(eq(outputStockAllocations.organizationId, ctx.organizationId), eq(outputStockAllocations.deliveryId, input.deliveryId)));
  return rows.reduce((sum, row) => sum + Number(row.dry), 0);
}
