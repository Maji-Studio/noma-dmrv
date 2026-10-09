import { findApiProductionRun, listApiProductionRuns } from "@/data-access/api-production-runs";
import type { ApiProductionRunFilters } from "@/data-access/api-production-runs";
import type { ApiLookupIdentifier } from "@/data-access/api-lookup-filters";
import type { OrgContext } from "@/lib/auth/server";
import { representProductionRun } from "@/lib/representations/production-runs";
import { readListPage, type ReadListQuery } from "./api-list";
import type { Executor } from "@/data-access/utils";

export function readApiProductionRunList(ctx: OrgContext, query: ReadListQuery<ApiProductionRunFilters>) {
  return readListPage(ctx, query, listApiProductionRuns, representProductionRun);
}

export async function readApiProductionRun(ctx: OrgContext, identifier: ApiLookupIdentifier, executor?: Executor) {
  return representProductionRun(await findApiProductionRun(ctx, identifier, executor));
}
