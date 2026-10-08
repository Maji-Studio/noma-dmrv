import { findApiFeedstock, listApiFeedstocks } from "@/data-access/api-feedstocks";
import type { ApiFacilityLookupFilters, ApiLookupIdentifier } from "@/data-access/api-lookup-filters";
import type { OrgContext } from "@/lib/auth/server";
import { representFeedstock } from "@/lib/api/representations/feedstocks";
import { readListPage, type ReadListQuery } from "./api-list";
import type { Executor } from "@/data-access/utils";

export function readApiFeedstockList(ctx: OrgContext, query: ReadListQuery<ApiFacilityLookupFilters>) {
  return readListPage(ctx, query, listApiFeedstocks, representFeedstock);
}

export async function readApiFeedstock(ctx: OrgContext, identifier: ApiLookupIdentifier, executor?: Executor) {
  return representFeedstock(await findApiFeedstock(ctx, identifier, executor));
}
