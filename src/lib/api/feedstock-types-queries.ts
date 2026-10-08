import { findApiFeedstockType, listApiFeedstockTypes } from "@/data-access/api-feedstock-types";
import type { ApiContext } from "@/lib/auth/api-context";
import { representFeedstockType } from "./representations/feedstock-types";
import { lookupListSchema, lookupGetSchema, lookupIdentifier, parseApiQuery, readLookupPage } from "./lookup-query";

export async function readFeedstockTypeList(request: Request, ctx: ApiContext) {
  const { limit, cursor, ...filters } = parseApiQuery(request, lookupListSchema);
  return readLookupPage(ctx, "feedstock-types", { limit, cursor, filters },
    listApiFeedstockTypes, representFeedstockType);
}

export async function readFeedstockType(request: Request, ctx: ApiContext, idOrCode: string) {
  parseApiQuery(request, lookupGetSchema);
  return representFeedstockType(await findApiFeedstockType(ctx, lookupIdentifier(idOrCode)));
}
