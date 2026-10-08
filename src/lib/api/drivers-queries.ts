import { readApiDriver, readApiDriverList } from "@/lib/read-models/api-drivers";
import type { ApiContext } from "@/lib/auth/api-context";
import { lookupListSchema, lookupGetSchema, lookupIdentifier, parseApiQuery, readLookupPage } from "./lookup-query";

export async function readDriverList(request: Request, ctx: ApiContext) {
  const { limit, cursor, ...filters } = parseApiQuery(request, lookupListSchema);
  return readLookupPage(ctx, "drivers", { limit, cursor, filters },
    readApiDriverList);
}

export async function readDriver(request: Request, ctx: ApiContext, idOrCode: string) {
  parseApiQuery(request, lookupGetSchema);
  return readApiDriver(ctx, lookupIdentifier(idOrCode));
}
