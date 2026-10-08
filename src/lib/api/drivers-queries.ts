import { findApiDriver, listApiDrivers } from "@/data-access/api-drivers";
import type { ApiContext } from "@/lib/auth/api-context";
import { representDriver } from "./representations/drivers";
import { lookupListSchema, lookupGetSchema, lookupIdentifier, parseApiQuery, readLookupPage } from "./lookup-query";

export async function readDriverList(request: Request, ctx: ApiContext) {
  const { limit, cursor, ...filters } = parseApiQuery(request, lookupListSchema);
  return readLookupPage(ctx, "drivers", { limit, cursor, filters },
    listApiDrivers, representDriver);
}

export async function readDriver(request: Request, ctx: ApiContext, idOrCode: string) {
  parseApiQuery(request, lookupGetSchema);
  return representDriver(await findApiDriver(ctx, lookupIdentifier(idOrCode)));
}
