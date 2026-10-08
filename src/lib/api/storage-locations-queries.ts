import { readApiStorageLocation, readApiStorageLocationList } from "@/lib/read-models/api-storage-locations";
import type { ApiContext } from "@/lib/auth/api-context";
import { facilityLookupListSchema, facilityLookupGetSchema, lookupIdentifier, parseApiQuery, readLookupPage } from "./lookup-query";

export async function readStorageLocationList(request: Request, ctx: ApiContext) {
  const { limit, cursor, ...filters } = parseApiQuery(request, facilityLookupListSchema);
  return readLookupPage(ctx, "storage-locations", { limit, cursor, filters },
    readApiStorageLocationList);
}

export async function readStorageLocation(request: Request, ctx: ApiContext, idOrCode: string) {
  const { facilityId } = parseApiQuery(request, facilityLookupGetSchema);
  return readApiStorageLocation(ctx, lookupIdentifier(idOrCode), facilityId);
}
