import type { z } from "zod";
import { readApiCustomer, readApiCustomerList } from "@/lib/read-models/api-customers";
import type { ApiContext } from "@/lib/auth/api-context";
import { lookupIdentifier, parseApiQuery, readLookupPage } from "./lookup-query";
import { resourceQueries } from "./query-schemas";

export async function readCustomerList(request: Request, ctx: ApiContext) {
  return readCustomerListFromInput(ctx, parseApiQuery(request, resourceQueries.customers.list));
}

export async function readCustomerListFromInput(ctx: ApiContext, input: z.output<typeof resourceQueries.customers.list>) {
  const { limit, cursor, ...filters } = input;
  return readLookupPage(ctx, "customers", { limit, cursor, filters },
    readApiCustomerList);
}

export async function readCustomer(request: Request, ctx: ApiContext, idOrCode: string) {
  parseApiQuery(request, resourceQueries.customers.get);
  return readApiCustomer(ctx, lookupIdentifier(idOrCode));
}
