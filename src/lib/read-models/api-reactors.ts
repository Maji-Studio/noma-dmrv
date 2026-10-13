import { findApiReactor, listApiReactors } from "@/data-access/api-reactors";
import type { ApiFacilityLookupFilters, ApiLookupIdentifier } from "@/data-access/api-lookup-filters";
import type { OrgContext } from "@/lib/auth/server";
import { representReactor } from "@/lib/representations/reactors";
import { readListPage, type ReadListQuery } from "./api-list";

export function readApiReactorList(ctx: OrgContext, query: ReadListQuery<ApiFacilityLookupFilters>) {
  return readListPage(ctx, query, listApiReactors, representReactor);
}

export async function readApiReactor(ctx: OrgContext, identifier: ApiLookupIdentifier, facilityId?: string) {
  return representReactor(await findApiReactor(ctx, identifier, facilityId));
}
