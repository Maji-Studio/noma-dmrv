import type { DbTransaction } from '@/db';
import { feedstockTypes, formulationIngredients, productIngredientSnapshots } from '@/db/schema';
import type { OrgContext } from '@/lib/auth/server';
import type { SavedIngredientSolids } from '@/lib/output-stock/sub-bin-ingredients';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { requireOrgScope } from './utils';

type Reader = Pick<DbTransaction, 'select'>;

/**
 * The ingredient lines each product saved when it was created, by material
 * name and in formulation order. Snapshots never change, so the read needs no
 * time filter; a biochar bin's layers are runs and have none.
 */
export async function savedIngredientSolids(ctx: OrgContext, productIds: readonly string[], tx: Reader): Promise<Map<string, SavedIngredientSolids[]>> {
  requireOrgScope(ctx);
  const byProduct = new Map<string, SavedIngredientSolids[]>();
  if (!productIds.length) return byProduct;
  const rows = await tx.select({ productId: productIngredientSnapshots.biocharProductId, name: feedstockTypes.name, drySolidsKg: productIngredientSnapshots.drySolidsKg })
    .from(productIngredientSnapshots)
    .innerJoin(formulationIngredients, and(eq(formulationIngredients.id, productIngredientSnapshots.formulationIngredientId), eq(formulationIngredients.organizationId, ctx.organizationId)))
    .innerJoin(feedstockTypes, and(eq(feedstockTypes.id, formulationIngredients.feedstockTypeId), eq(feedstockTypes.organizationId, ctx.organizationId)))
    .where(and(eq(productIngredientSnapshots.organizationId, ctx.organizationId), inArray(productIngredientSnapshots.biocharProductId, [...productIds])))
    .orderBy(asc(productIngredientSnapshots.biocharProductId), asc(formulationIngredients.sortOrder), asc(formulationIngredients.id));
  for (const row of rows) byProduct.set(row.productId, [...(byProduct.get(row.productId) ?? []), { name: row.name, drySolidsKg: Number(row.drySolidsKg) }]);
  return byProduct;
}
