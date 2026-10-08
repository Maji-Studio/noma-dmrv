import { findApiVehicle, listApiVehicles } from "@/data-access/api-vehicles";
import type { ApiContext } from "@/lib/auth/api-context";
import { representVehicle } from "./representations/vehicles";
import { lookupListSchema, lookupGetSchema, lookupIdentifier, parseApiQuery, readLookupPage } from "./lookup-query";

export async function readVehicleList(request: Request, ctx: ApiContext) {
  const { limit, cursor, ...filters } = parseApiQuery(request, lookupListSchema);
  return readLookupPage(ctx, "vehicles", { limit, cursor, filters },
    listApiVehicles, representVehicle);
}

export async function readVehicle(request: Request, ctx: ApiContext, idOrCode: string) {
  parseApiQuery(request, lookupGetSchema);
  return representVehicle(await findApiVehicle(ctx, lookupIdentifier(idOrCode)));
}
