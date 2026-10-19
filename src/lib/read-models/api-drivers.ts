import { findApiDriver, listApiDrivers } from "@/data-access/api-drivers";
import type { ApiLookupFilters, ApiLookupIdentifier } from "@/data-access/api-lookup-filters";
import type { OrgContext } from "@/lib/auth/server";
import { representDriver } from "@/lib/representations/drivers";
import { readListPage, type ReadListQuery } from "./api-list";

export function readApiDriverList(ctx: OrgContext, query: ReadListQuery<ApiLookupFilters>) {
  return readListPage(ctx, query, listApiDrivers, representDriver);
}

export async function readApiDriver(ctx: OrgContext, identifier: ApiLookupIdentifier) {
  return representDriver(await findApiDriver(ctx, identifier));
}
