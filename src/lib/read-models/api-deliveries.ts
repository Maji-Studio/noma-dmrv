import type { Executor } from "@/data-access/utils";
import type { ApiDeliveryFilters } from "@/data-access/api-deliveries";
import { findApiDelivery, listApiDeliveries } from "@/data-access/api-deliveries";
import type { ApiLookupIdentifier } from "@/data-access/api-lookup-filters";
import type { OrgContext } from "@/lib/auth/server";
import { representDelivery } from "@/lib/representations/deliveries";
import { readListPage, type ReadListQuery } from "./api-list";

export function readApiDeliveryList(ctx: OrgContext, query: ReadListQuery<ApiDeliveryFilters>) {
  return readListPage(ctx, query, listApiDeliveries, representDelivery);
}

export async function readApiDelivery(ctx: OrgContext, identifier: ApiLookupIdentifier, executor?: Executor) {
  return representDelivery(await findApiDelivery(ctx, identifier, executor));
}
