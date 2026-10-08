import { readApiSupplier, readApiSupplierList } from "@/lib/read-models/api-suppliers";
import type { ApiContext } from "@/lib/auth/api-context";
import { lookupIdentifier, parseApiQuery, readLookupPage } from "./lookup-query";
import { resourceQueries } from "./query-schemas";

export async function readSupplierList(request: Request, ctx: ApiContext) {
  const { limit, cursor, ...filters } = parseApiQuery(request, resourceQueries.suppliers.list);
  return readLookupPage(ctx, "suppliers", { limit, cursor, filters },
    readApiSupplierList);
}

export async function readSupplier(request: Request, ctx: ApiContext, idOrCode: string) {
  parseApiQuery(request, resourceQueries.suppliers.get);
  return readApiSupplier(ctx, lookupIdentifier(idOrCode));
}
