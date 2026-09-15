import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  suppliers,
  supplierLocations,
  type Supplier,
  type SupplierLocation,
} from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "./utils";

export interface SupplierDetailData {
  supplier: Supplier;
  locations: SupplierLocation[];
}

/**
 * Resolve the complete payload used by the full supplier detail route.
 *
 * The supplier and its locations are independently organization-scoped and
 * loaded in parallel. A missing supplier returns `null` so the route can keep
 * its not-found contract without doing a smaller existence query first.
 */
export async function findSupplierDetail(
  ctx: OrgContext,
  supplierId: string,
): Promise<SupplierDetailData | null> {
  requireOrgScope(ctx);

  const [[supplier], locations] = await Promise.all([
    db
      .select()
      .from(suppliers)
      .where(
        and(
          eq(suppliers.id, supplierId),
          eq(suppliers.organizationId, ctx.organizationId),
        ),
      )
      .limit(1),
    db
      .select()
      .from(supplierLocations)
      .where(
        and(
          eq(supplierLocations.supplierId, supplierId),
          eq(supplierLocations.organizationId, ctx.organizationId),
        ),
      )
      .orderBy(
        desc(supplierLocations.isDefault),
        asc(supplierLocations.createdAt),
      ),
  ]);

  return supplier ? { supplier, locations } : null;
}
