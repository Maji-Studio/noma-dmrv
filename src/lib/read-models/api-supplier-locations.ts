import { findApiSupplierLocation, listApiSupplierLocations } from "@/data-access/api-supplier-locations";
import type { ApiLookupPosition } from "@/data-access/api-lookup-filters";
import type { Executor } from "@/data-access/utils";
import type { OrgContext } from "@/lib/auth/server";
import { representSupplierLocation } from "@/lib/representations/supplier-locations";
import { readListPage, type ReadListQuery } from "./api-list";

export function readApiSupplierLocationList(ctx: OrgContext, query: ReadListQuery<{ supplierId: string; q?: string }>, executor?: Executor) {
  const list = (ctx: OrgContext, filters: { supplierId: string; q?: string }, limit: number, cursor?: ApiLookupPosition) =>
    listApiSupplierLocations(ctx, filters, limit, cursor, executor);
  return readListPage(ctx, query, list, representSupplierLocation);
}

export async function readApiSupplierLocation(ctx: OrgContext, supplierId: string, locationId: string, executor?: Executor) {
  const row = await findApiSupplierLocation(ctx, supplierId, locationId, executor);
  return row ? representSupplierLocation(row) : null;
}
