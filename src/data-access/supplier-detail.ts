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

/**
 * The one ordering for a supplier's locations: the default first, then oldest
 * first. Every surface that lists them shares this, so a cache seeded on the
 * server and the refetch of the same query key can never disagree on order.
 */
export const SUPPLIER_LOCATION_ORDER = [
  desc(supplierLocations.isDefault),
  asc(supplierLocations.createdAt),
];

/**
 * The one supplier row read. Returns `undefined` for an absent or
 * out-of-organization supplier; callers that owe an error raise it themselves.
 */
export async function findSupplierRow(
  ctx: OrgContext,
  supplierId: string,
): Promise<Supplier | undefined> {
  requireOrgScope(ctx);

  const [supplier] = await db
    .select()
    .from(suppliers)
    .where(
      and(
        eq(suppliers.id, supplierId),
        eq(suppliers.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);

  return supplier;
}

/** The one supplier-locations read. */
export async function findSupplierLocations(
  ctx: OrgContext,
  supplierId: string,
): Promise<SupplierLocation[]> {
  requireOrgScope(ctx);

  return db
    .select()
    .from(supplierLocations)
    .where(
      and(
        eq(supplierLocations.supplierId, supplierId),
        eq(supplierLocations.organizationId, ctx.organizationId),
      ),
    )
    .orderBy(...SUPPLIER_LOCATION_ORDER);
}
