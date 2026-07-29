import { and, eq, isNull, or } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import {
  biocharProductSourceAllocations,
  biocharProducts,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
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
