import type { ApiContext } from "@/lib/auth/api-context";
import { readApiFeedstock, readApiFeedstockList } from "@/lib/read-models/api-feedstocks";
import { facilityLookupListSchema, lookupIdentifier, parseApiQuery, readLookupPage } from "./lookup-query";

export async function readFeedstockList(request: Request, ctx: ApiContext) {
  const { limit, cursor, ...filters } = parseApiQuery(request, facilityLookupListSchema);
  return readLookupPage(ctx, "feedstocks", { limit, cursor, filters }, readApiFeedstockList);
}

export async function readFeedstock(ctx: ApiContext, idOrCode: string) {
  return readApiFeedstock(ctx, lookupIdentifier(idOrCode));
}
