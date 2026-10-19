import { findApiVehicle, listApiVehicles } from "@/data-access/api-vehicles";
import type { ApiLookupFilters, ApiLookupIdentifier } from "@/data-access/api-lookup-filters";
import type { OrgContext } from "@/lib/auth/server";
import { representVehicle } from "@/lib/representations/vehicles";
import { readListPage, type ReadListQuery } from "./api-list";

export function readApiVehicleList(ctx: OrgContext, query: ReadListQuery<ApiLookupFilters>) {
  return readListPage(ctx, query, listApiVehicles, representVehicle);
}

export async function readApiVehicle(ctx: OrgContext, identifier: ApiLookupIdentifier) {
  return representVehicle(await findApiVehicle(ctx, identifier));
}
