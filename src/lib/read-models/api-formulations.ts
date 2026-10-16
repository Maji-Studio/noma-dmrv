import type { Executor } from "@/data-access/utils";
import { findApiFormulation, listApiFormulations, type ApiFormulationFilters } from "@/data-access/api-formulations";
import type { ApiLookupIdentifier, ApiLookupPosition } from "@/data-access/api-lookup-filters";
import type { OrgContext } from "@/lib/auth/server";
import { representFormulation } from "@/lib/representations/formulations";
import { readListPage, type ReadListQuery } from "./api-list";

export function readApiFormulationList(ctx: OrgContext, query: ReadListQuery<ApiFormulationFilters>, executor?: Executor) {
  const list = (ctx: OrgContext, filters: ApiFormulationFilters, limit: number, cursor?: ApiLookupPosition) =>
    listApiFormulations(ctx, filters, limit, cursor, executor);
  return readListPage(ctx, query, list, representFormulation);
}

export async function readApiFormulation(ctx: OrgContext, identifier: ApiLookupIdentifier, executor?: Executor) {
  return representFormulation(await findApiFormulation(ctx, identifier, executor));
}
