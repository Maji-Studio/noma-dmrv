import { findApiCustomerLocation, listApiCustomerLocations } from "@/data-access/api-customer-locations";
import type { ApiLookupPosition } from "@/data-access/api-lookup-filters";
import type { Executor } from "@/data-access/utils";
import type { OrgContext } from "@/lib/auth/server";
import { representCustomerLocation } from "@/lib/representations/customer-locations";
import { readListPage, type ReadListQuery } from "./api-list";

export function readApiCustomerLocationList(ctx: OrgContext, query: ReadListQuery<{ customerId: string; q?: string; archived?: boolean }>, executor?: Executor) {
  const list = (ctx: OrgContext, filters: { customerId: string; q?: string; archived?: boolean }, limit: number, cursor?: ApiLookupPosition) =>
    listApiCustomerLocations(ctx, filters, limit, cursor, executor);
  return readListPage(ctx, query, list, representCustomerLocation);
}

export async function readApiCustomerLocation(ctx: OrgContext, customerId: string, locationId: string, executor?: Executor) {
  const row = await findApiCustomerLocation(ctx, customerId, locationId, executor);
  return row ? representCustomerLocation(row) : null;
}
