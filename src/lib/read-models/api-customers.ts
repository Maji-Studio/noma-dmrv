import type { Executor } from "@/data-access/utils";
import { findApiCustomer, listApiCustomers } from "@/data-access/api-customers";
import type { ApiLookupFilters, ApiLookupIdentifier } from "@/data-access/api-lookup-filters";
import type { OrgContext } from "@/lib/auth/server";
import { representCustomer } from "@/lib/representations/customers";
import { readListPage, type ReadListQuery } from "./api-list";

export function readApiCustomerList(ctx: OrgContext, query: ReadListQuery<ApiLookupFilters & { archived?: boolean }>) {
  return readListPage(ctx, query, listApiCustomers, representCustomer);
}

export async function readApiCustomer(ctx: OrgContext, identifier: ApiLookupIdentifier, executor?: Executor) {
  return representCustomer(await findApiCustomer(ctx, identifier, executor));
}
