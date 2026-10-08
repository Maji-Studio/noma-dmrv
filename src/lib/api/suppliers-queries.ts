import { findApiSupplier, listApiSuppliers } from "@/data-access/api-suppliers";
import type { ApiContext } from "@/lib/auth/api-context";
import { representSupplier } from "./representations/suppliers";
import { lookupListSchema, lookupGetSchema, lookupIdentifier, parseApiQuery, readLookupPage } from "./lookup-query";

export async function readSupplierList(request: Request, ctx: ApiContext) {
  const { limit, cursor, ...filters } = parseApiQuery(request, lookupListSchema);
  return readLookupPage(ctx, "suppliers", { limit, cursor, filters },
    listApiSuppliers, representSupplier);
}

export async function readSupplier(request: Request, ctx: ApiContext, idOrCode: string) {
  parseApiQuery(request, lookupGetSchema);
  return representSupplier(await findApiSupplier(ctx, lookupIdentifier(idOrCode)));
}
