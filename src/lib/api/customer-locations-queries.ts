import { DomainError } from "@/lib/domain-errors";
import { partyLocationNotFound } from "@/lib/party-domain-errors";
import { canonicalUuid } from "./canonical-uuid";
import type { z } from "zod";
import { readApiCustomerLocation, readApiCustomerLocationList } from "@/lib/read-models/api-customer-locations";
import { readApiCustomer } from "@/lib/read-models/api-customers";
import type { ApiContext } from "@/lib/auth/api-context";
import { lookupIdentifier, parseApiQuery, readLookupPage } from "./lookup-query";
import { customerLocationListSchema, lookupGetSchema } from "./query-schemas";

export async function readCustomerLocationList(request: Request, ctx: ApiContext, idOrCode: string) {
  return readCustomerLocationListFromInput(ctx, parseApiQuery(request, customerLocationListSchema), idOrCode);
}

export async function readCustomerLocationListFromInput(ctx: ApiContext, input: z.output<typeof customerLocationListSchema>, idOrCode: string) {
  const { limit, cursor, ...filters } = input;
  const customer = await readApiCustomer(ctx, lookupIdentifier(idOrCode));
  return readLookupPage(ctx, "customer-locations", { limit, cursor, filters: { ...filters, customerId: customer.id } }, readApiCustomerLocationList);
}

export async function readCustomerLocation(request: Request, ctx: ApiContext, idOrCode: string, segment: string) {
  parseApiQuery(request, lookupGetSchema);
  const locationId = canonicalUuid(segment);
  if (!locationId) throw partyLocationNotFound("customer");
  const customer = await readApiCustomer(ctx, lookupIdentifier(idOrCode)).catch(error => {
    if (error instanceof DomainError && error.code === "not_found") throw partyLocationNotFound("customer");
    throw error;
  });
  const row = await readApiCustomerLocation(ctx, customer.id, locationId);
  if (!row) throw partyLocationNotFound("customer");
  return row;
}
