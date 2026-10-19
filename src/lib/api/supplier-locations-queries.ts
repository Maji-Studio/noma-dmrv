import { lookupGetSchema } from "./query-schemas";
import { partyLocationNotFound } from "@/lib/party-domain-errors";
import { z } from "zod";
import { readApiSupplierLocation, readApiSupplierLocationList } from "@/lib/read-models/api-supplier-locations";
import type { ApiContext } from "@/lib/auth/api-context";
import { DomainError } from "@/lib/domain-errors";
import { parseApiQuery, readLookupPage, supplierLocationListSchema } from "./lookup-query";
import { canonicalUuid } from "./canonical-uuid";

export async function readSupplierLocationList(request: Request, ctx: ApiContext, supplierId: string) {
  return readSupplierLocationListFromInput(ctx, parseApiQuery(request, supplierLocationListSchema), supplierId);
}

export async function readSupplierLocationListFromInput(ctx: ApiContext, input: z.output<typeof supplierLocationListSchema>, segment: string) {
  const { limit, cursor, ...filters } = input;
  const supplierId = canonicalUuid(segment);
  if (!supplierId) throw new DomainError("not_found", "Supplier was not found.");
  return readLookupPage(ctx, "supplier-locations", { limit, cursor, filters: { ...filters, supplierId } },
    readApiSupplierLocationList);
}

export async function readSupplierLocation(request: Request, ctx: ApiContext, segment: string, childSegment: string) {
  parseApiQuery(request, lookupGetSchema);
  const supplierId = canonicalUuid(segment);
  const locationId = canonicalUuid(childSegment);
  if (!supplierId || !locationId) throw partyLocationNotFound("supplier");
  const row = await readApiSupplierLocation(ctx, supplierId, locationId);
  if (!row) throw partyLocationNotFound("supplier");
  return row;
}
