import type { z } from "zod";
import { readApiDelivery, readApiDeliveryList } from "@/lib/read-models/api-deliveries";
import type { ApiContext } from "@/lib/auth/api-context";
import { lookupIdentifier, parseApiQuery, readLookupPage } from "./lookup-query";
import { resourceQueries } from "./query-schemas";

export async function readDeliveryList(request: Request, ctx: ApiContext) {
  return readDeliveryListFromInput(ctx, parseApiQuery(request, resourceQueries.deliveries.list));
}

export async function readDeliveryListFromInput(ctx: ApiContext, input: z.output<typeof resourceQueries.deliveries.list>) {
  const { limit, cursor, ...filters } = input;
  return readLookupPage(ctx, "deliveries", { limit, cursor, filters },
    readApiDeliveryList);
}

export async function readDelivery(request: Request, ctx: ApiContext, idOrCode: string) {
  parseApiQuery(request, resourceQueries.deliveries.get);
  return readApiDelivery(ctx, lookupIdentifier(idOrCode));
}
