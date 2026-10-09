import type { z } from "zod";
import { readApiSupplier, readApiSupplierList } from "@/lib/read-models/api-suppliers";
import type { ApiContext } from "@/lib/auth/api-context";
import { lookupIdentifier, parseApiQuery, readLookupPage } from "./lookup-query";
import { resourceQueries } from "./query-schemas";

export async function readSupplierList(request: Request, ctx: ApiContext) {
  return readSupplierListFromInput(ctx, parseApiQuery(request, resourceQueries.suppliers.list));
}

export async function readSupplierListFromInput(ctx: ApiContext, input: z.output<typeof resourceQueries.suppliers.list>) {
  const { limit, cursor, ...filters } = input;
  return readLookupPage(ctx, "suppliers", { limit, cursor, filters },
    readApiSupplierList);
}

export async function readSupplier(request: Request, ctx: ApiContext, idOrCode: string) {
  parseApiQuery(request, resourceQueries.suppliers.get);
  return readApiSupplier(ctx, lookupIdentifier(idOrCode));
}
