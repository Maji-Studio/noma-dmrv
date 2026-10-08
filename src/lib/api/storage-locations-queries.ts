import { readApiStorageLocation, readApiStorageLocationList } from "@/lib/read-models/api-storage-locations";
import type { ApiContext } from "@/lib/auth/api-context";
import { lookupIdentifier, parseApiQuery, readLookupPage } from "./lookup-query";
import { resourceQueries } from "./query-schemas";

export async function readStorageLocationList(request: Request, ctx: ApiContext) {
  const { limit, cursor, ...filters } = parseApiQuery(request, resourceQueries["storage-locations"].list);
  return readLookupPage(ctx, "storage-locations", { limit, cursor, filters },
    readApiStorageLocationList);
}

export async function readStorageLocation(request: Request, ctx: ApiContext, idOrCode: string) {
  const { facilityId } = parseApiQuery(request, resourceQueries["storage-locations"].get);
  return readApiStorageLocation(ctx, lookupIdentifier(idOrCode), facilityId);
}
