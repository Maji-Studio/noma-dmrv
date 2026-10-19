import type { z } from "zod";
import { readApiStorageLocation, readApiStorageLocationList } from "@/lib/read-models/api-storage-locations";
import type { ApiContext } from "@/lib/auth/api-context";
import { lookupIdentifier, parseApiQuery, readLookupPage } from "./lookup-query";
import { resourceQueries } from "./query-schemas";

export async function readStorageLocationList(request: Request, ctx: ApiContext) {
  return readStorageLocationListFromInput(ctx, parseApiQuery(request, resourceQueries["storage-locations"].list));
}

export async function readStorageLocationListFromInput(ctx: ApiContext, input: z.output<(typeof resourceQueries)["storage-locations"]["list"]>) {
  const { limit, cursor, ...filters } = input;
  return readLookupPage(ctx, "storage-locations", { limit, cursor, filters },
    readApiStorageLocationList);
}

export async function readStorageLocation(request: Request, ctx: ApiContext, idOrCode: string) {
  const { facilityId } = parseApiQuery(request, resourceQueries["storage-locations"].get);
  return readApiStorageLocation(ctx, lookupIdentifier(idOrCode), facilityId);
}
