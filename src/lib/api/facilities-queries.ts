import { readApiFacility, readApiFacilityList } from "@/lib/read-models/api-facilities";
import type { ApiContext } from "@/lib/auth/api-context";
import { lookupIdentifier, parseApiQuery, readLookupPage } from "./lookup-query";
import { resourceQueries } from "./query-schemas";

export async function readFacilityList(request: Request, ctx: ApiContext) {
  const { limit, cursor, ...filters } = parseApiQuery(request, resourceQueries.facilities.list);
  return readLookupPage(ctx, "facilities", { limit, cursor, filters },
    readApiFacilityList);
}

export async function readFacility(request: Request, ctx: ApiContext, idOrCode: string) {
  parseApiQuery(request, resourceQueries.facilities.get);
  return readApiFacility(ctx, lookupIdentifier(idOrCode));
}
