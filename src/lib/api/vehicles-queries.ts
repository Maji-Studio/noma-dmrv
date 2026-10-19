import type { z } from "zod";
import { readApiVehicle, readApiVehicleList } from "@/lib/read-models/api-vehicles";
import type { ApiContext } from "@/lib/auth/api-context";
import { lookupIdentifier, parseApiQuery, readLookupPage } from "./lookup-query";
import { resourceQueries } from "./query-schemas";

export async function readVehicleList(request: Request, ctx: ApiContext) {
  return readVehicleListFromInput(ctx, parseApiQuery(request, resourceQueries.vehicles.list));
}

export async function readVehicleListFromInput(ctx: ApiContext, input: z.output<typeof resourceQueries.vehicles.list>) {
  const { limit, cursor, ...filters } = input;
  return readLookupPage(ctx, "vehicles", { limit, cursor, filters },
    readApiVehicleList);
}

export async function readVehicle(request: Request, ctx: ApiContext, idOrCode: string) {
  parseApiQuery(request, resourceQueries.vehicles.get);
  return readApiVehicle(ctx, lookupIdentifier(idOrCode));
}
