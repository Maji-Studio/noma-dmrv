import { readApiFacility, readApiFacilityList } from "@/lib/read-models/api-facilities";
import type { ApiContext } from "@/lib/auth/api-context";
import { lookupListSchema, lookupGetSchema, lookupIdentifier, parseApiQuery, readLookupPage } from "./lookup-query";

export async function readFacilityList(request: Request, ctx: ApiContext) {
  const { limit, cursor, ...filters } = parseApiQuery(request, lookupListSchema);
  return readLookupPage(ctx, "facilities", { limit, cursor, filters },
    readApiFacilityList);
}

export async function readFacility(request: Request, ctx: ApiContext, idOrCode: string) {
  parseApiQuery(request, lookupGetSchema);
  return readApiFacility(ctx, lookupIdentifier(idOrCode));
}
