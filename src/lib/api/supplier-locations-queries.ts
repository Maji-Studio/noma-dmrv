import { z } from "zod";
import { readApiSupplierLocationList } from "@/lib/read-models/api-supplier-locations";
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
