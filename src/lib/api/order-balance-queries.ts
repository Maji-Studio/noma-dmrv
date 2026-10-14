import type { ApiContext } from "@/lib/auth/api-context";
import { readApiOrderBalance } from "@/lib/read-models/api-order-balance";
import { lookupIdentifier, parseApiQuery } from "./lookup-query";
import { resourceQueries } from "./query-schemas";

export async function readOrderBalance(request: Request, ctx: ApiContext, idOrCode: string) {
  parseApiQuery(request, resourceQueries.orders.get);
  return readOrderBalanceFromInput(ctx, idOrCode);
}
export async function readOrderBalanceFromInput(ctx: ApiContext, idOrCode: string) {
  return readApiOrderBalance(ctx, lookupIdentifier(idOrCode));
}
