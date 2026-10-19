import { findApiStorageLocation, listApiStorageLocations, type ApiStorageLocationFilters } from "@/data-access/api-storage-locations";
import type { ApiLookupIdentifier } from "@/data-access/api-lookup-filters";
import type { OrgContext } from "@/lib/auth/server";
import { representStorageLocation } from "@/lib/representations/storage-locations";
import { readListPage, type ReadListQuery } from "./api-list";

export function readApiStorageLocationList(ctx: OrgContext, query: ReadListQuery<ApiStorageLocationFilters>) {
  return readListPage(ctx, query, listApiStorageLocations, representStorageLocation);
}

export async function readApiStorageLocation(ctx: OrgContext, identifier: ApiLookupIdentifier, facilityId?: string) {
  return representStorageLocation(await findApiStorageLocation(ctx, identifier, facilityId));
}
