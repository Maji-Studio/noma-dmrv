import { findApiFeedstockType, listApiFeedstockTypes } from "@/data-access/api-feedstock-types";
import type { ApiLookupFilters, ApiLookupIdentifier } from "@/data-access/api-lookup-filters";
import type { OrgContext } from "@/lib/auth/server";
import { representFeedstockType } from "@/lib/representations/feedstock-types";
import { readListPage, type ReadListQuery } from "./api-list";

export function readApiFeedstockTypeList(ctx: OrgContext, query: ReadListQuery<ApiLookupFilters>) {
  return readListPage(ctx, query, listApiFeedstockTypes, representFeedstockType);
}

export async function readApiFeedstockType(ctx: OrgContext, identifier: ApiLookupIdentifier) {
  return representFeedstockType(await findApiFeedstockType(ctx, identifier));
}
