import { readApiDriver, readApiDriverList } from "@/lib/read-models/api-drivers";
import type { ApiContext } from "@/lib/auth/api-context";
import { lookupIdentifier, parseApiQuery, readLookupPage } from "./lookup-query";
import { resourceQueries } from "./query-schemas";

export async function readDriverList(request: Request, ctx: ApiContext) {
  const { limit, cursor, ...filters } = parseApiQuery(request, resourceQueries.drivers.list);
  return readLookupPage(ctx, "drivers", { limit, cursor, filters },
    readApiDriverList);
}

export async function readDriver(request: Request, ctx: ApiContext, idOrCode: string) {
  parseApiQuery(request, resourceQueries.drivers.get);
  return readApiDriver(ctx, lookupIdentifier(idOrCode));
}
