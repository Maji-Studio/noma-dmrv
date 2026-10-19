import type { Executor } from "@/data-access/utils";
import type { ApiOrderFilters } from "@/data-access/api-orders";
import { findApiOrder, listApiOrders } from "@/data-access/api-orders";
import type { ApiLookupIdentifier } from "@/data-access/api-lookup-filters";
import type { OrgContext } from "@/lib/auth/server";
import { representOrder } from "@/lib/representations/orders";
import { readListPage, type ReadListQuery } from "./api-list";

export function readApiOrderList(ctx: OrgContext, query: ReadListQuery<ApiOrderFilters>) {
  return readListPage(ctx, query, listApiOrders, representOrder);
}

export async function readApiOrder(ctx: OrgContext, identifier: ApiLookupIdentifier, executor?: Executor) {
  return representOrder(await findApiOrder(ctx, identifier, executor));
}
