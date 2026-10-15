import type { ApiContext } from "@/lib/auth/api-context";
import { readApiDeliveryApplicationBalance } from "@/lib/read-models/api-delivery-application-balance";
import { lookupIdentifier, parseApiQuery } from "./lookup-query";
import { lookupGetSchema } from "./query-schemas";

export async function readDeliveryApplicationBalance(request: Request, ctx: ApiContext, idOrCode: string) {
  parseApiQuery(request, lookupGetSchema);
  return readApiDeliveryApplicationBalance(ctx, lookupIdentifier(idOrCode));
}
