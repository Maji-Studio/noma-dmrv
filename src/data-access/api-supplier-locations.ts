import { and, desc, eq, getTableColumns } from "drizzle-orm";
import { db } from "@/db";
import { supplierLocations } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { requireOrgScope } from "./utils";
import { findApiSupplier } from "./api-suppliers";
import {
  lookupSearch,
  lookupPosition,
  lookupCursorCreatedAt,
  type ApiLookupPosition,
} from "./api-lookup-filters";

export async function listApiSupplierLocations(
  ctx: OrgContext, filters: { supplierId: string; q?: string }, limit: number, cursor?: ApiLookupPosition,
) {
  requireOrgScope(ctx);
  await findApiSupplier(ctx, { id: filters.supplierId });
  return db.select({
    ...getTableColumns(supplierLocations), cursorCreatedAt: lookupCursorCreatedAt(supplierLocations.createdAt),
  }).from(supplierLocations).where(and(
    eq(supplierLocations.organizationId, ctx.organizationId), eq(supplierLocations.supplierId, filters.supplierId),
    lookupSearch({ name: supplierLocations.name }, filters.q), lookupPosition(supplierLocations, cursor),
  )).orderBy(desc(supplierLocations.createdAt), desc(supplierLocations.id)).limit(limit + 1);
}
