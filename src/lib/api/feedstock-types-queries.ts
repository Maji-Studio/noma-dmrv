import { readApiFeedstockType, readApiFeedstockTypeList } from "@/lib/read-models/api-feedstock-types";
import type { ApiContext } from "@/lib/auth/api-context";
import { lookupListSchema, lookupGetSchema, lookupIdentifier, parseApiQuery, readLookupPage } from "./lookup-query";

export async function readFeedstockTypeList(request: Request, ctx: ApiContext) {
  const { limit, cursor, ...filters } = parseApiQuery(request, lookupListSchema);
  return readLookupPage(ctx, "feedstock-types", { limit, cursor, filters },
    readApiFeedstockTypeList);
}

export async function readFeedstockType(request: Request, ctx: ApiContext, idOrCode: string) {
  parseApiQuery(request, lookupGetSchema);
  return readApiFeedstockType(ctx, lookupIdentifier(idOrCode));
}
