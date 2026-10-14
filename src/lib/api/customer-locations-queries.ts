import type { z } from "zod";
import { readApiCustomerLocationList } from "@/lib/read-models/api-customer-locations";
import { readApiCustomer } from "@/lib/read-models/api-customers";
import type { ApiContext } from "@/lib/auth/api-context";
import { lookupIdentifier, parseApiQuery, readLookupPage } from "./lookup-query";
import { customerLocationListSchema } from "./query-schemas";

export async function readCustomerLocationList(request: Request, ctx: ApiContext, idOrCode: string) {
  return readCustomerLocationListFromInput(ctx, parseApiQuery(request, customerLocationListSchema), idOrCode);
}

export async function readCustomerLocationListFromInput(ctx: ApiContext, input: z.output<typeof customerLocationListSchema>, idOrCode: string) {
  const { limit, cursor, ...filters } = input;
  const customer = await readApiCustomer(ctx, lookupIdentifier(idOrCode));
  return readLookupPage(ctx, "customer-locations", { limit, cursor, filters: { ...filters, customerId: customer.id } }, readApiCustomerLocationList);
}
