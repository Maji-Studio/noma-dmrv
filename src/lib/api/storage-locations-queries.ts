import { findApiStorageLocation, listApiStorageLocations } from "@/data-access/api-storage-locations";
import type { ApiContext } from "@/lib/auth/api-context";
import { representStorageLocation } from "./representations/storage-locations";
import { facilityLookupListSchema, facilityLookupGetSchema, lookupIdentifier, parseApiQuery, readLookupPage } from "./lookup-query";

export async function readStorageLocationList(request: Request, ctx: ApiContext) {
  const { limit, cursor, ...filters } = parseApiQuery(request, facilityLookupListSchema);
  return readLookupPage(ctx, "storage-locations", { limit, cursor, filters },
    listApiStorageLocations, representStorageLocation);
}

export async function readStorageLocation(request: Request, ctx: ApiContext, idOrCode: string) {
  const { facilityId } = parseApiQuery(request, facilityLookupGetSchema);
  return representStorageLocation(await findApiStorageLocation(ctx, lookupIdentifier(idOrCode), facilityId));
}
