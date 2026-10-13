import { findApiFormulation, listApiFormulations } from "@/data-access/api-formulations";
import type { ApiLookupFilters, ApiLookupIdentifier } from "@/data-access/api-lookup-filters";
import type { OrgContext } from "@/lib/auth/server";
import { representFormulation } from "@/lib/representations/formulations";
import { readListPage, type ReadListQuery } from "./api-list";

export function readApiFormulationList(ctx: OrgContext, query: ReadListQuery<ApiLookupFilters>) {
  return readListPage(ctx, query, listApiFormulations, representFormulation);
}

export async function readApiFormulation(ctx: OrgContext, identifier: ApiLookupIdentifier) {
  return representFormulation(await findApiFormulation(ctx, identifier));
}
