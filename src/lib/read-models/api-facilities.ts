import { findApiFacility, listApiFacilities } from "@/data-access/api-facilities";
import type { ApiLookupFilters, ApiLookupIdentifier } from "@/data-access/api-lookup-filters";
import type { OrgContext } from "@/lib/auth/server";
import { representFacility } from "@/lib/api/representations/facilities";
import { readListPage, type ReadListQuery } from "./api-list";

export function readApiFacilityList(ctx: OrgContext, query: ReadListQuery<ApiLookupFilters>) {
  return readListPage(ctx, query, listApiFacilities, representFacility);
}

export async function readApiFacility(ctx: OrgContext, identifier: ApiLookupIdentifier) {
  return representFacility(await findApiFacility(ctx, identifier));
}
