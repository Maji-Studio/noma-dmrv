import { findApiFacility, listApiFacilities } from "@/data-access/api-facilities";
import type { ApiContext } from "@/lib/auth/api-context";
import { representFacility } from "./representations/facilities";
import { lookupListSchema, lookupGetSchema, lookupIdentifier, parseApiQuery, readLookupPage } from "./lookup-query";

export async function readFacilityList(request: Request, ctx: ApiContext) {
  const { limit, cursor, ...filters } = parseApiQuery(request, lookupListSchema);
  return readLookupPage(ctx, "facilities", { limit, cursor, filters },
    listApiFacilities, representFacility);
}

export async function readFacility(request: Request, ctx: ApiContext, idOrCode: string) {
  parseApiQuery(request, lookupGetSchema);
  return representFacility(await findApiFacility(ctx, lookupIdentifier(idOrCode)));
}
