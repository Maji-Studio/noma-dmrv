import { listApiCustomerLocations } from "@/data-access/api-customer-locations";
import type { OrgContext } from "@/lib/auth/server";
import { representCustomerLocation } from "@/lib/representations/customer-locations";
import { readListPage, type ReadListQuery } from "./api-list";

export function readApiCustomerLocationList(ctx: OrgContext, query: ReadListQuery<{ customerId: string; q?: string }>) {
  return readListPage(ctx, query, listApiCustomerLocations, representCustomerLocation);
}
