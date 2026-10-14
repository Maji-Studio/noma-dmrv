import type { z } from "zod";
import { readApiOrder, readApiOrderList } from "@/lib/read-models/api-orders";
import type { ApiContext } from "@/lib/auth/api-context";
import { lookupIdentifier, parseApiQuery, readLookupPage } from "./lookup-query";
import { resourceQueries } from "./query-schemas";

export async function readOrderList(request: Request, ctx: ApiContext) {
  return readOrderListFromInput(ctx, parseApiQuery(request, resourceQueries.orders.list));
}

export async function readOrderListFromInput(ctx: ApiContext, input: z.output<typeof resourceQueries.orders.list>) {
  const { limit, cursor, ...filters } = input;
  return readLookupPage(ctx, "orders", { limit, cursor, filters },
    readApiOrderList);
}

export async function readOrder(request: Request, ctx: ApiContext, idOrCode: string) {
  parseApiQuery(request, resourceQueries.orders.get);
  return readApiOrder(ctx, lookupIdentifier(idOrCode));
}
