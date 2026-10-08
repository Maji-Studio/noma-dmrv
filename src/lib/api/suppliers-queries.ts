import { readApiSupplier, readApiSupplierList } from "@/lib/read-models/api-suppliers";
import type { ApiContext } from "@/lib/auth/api-context";
import { lookupListSchema, lookupGetSchema, lookupIdentifier, parseApiQuery, readLookupPage } from "./lookup-query";

export async function readSupplierList(request: Request, ctx: ApiContext) {
  const { limit, cursor, ...filters } = parseApiQuery(request, lookupListSchema);
  return readLookupPage(ctx, "suppliers", { limit, cursor, filters },
    readApiSupplierList);
}

export async function readSupplier(request: Request, ctx: ApiContext, idOrCode: string) {
  parseApiQuery(request, lookupGetSchema);
  return readApiSupplier(ctx, lookupIdentifier(idOrCode));
}
