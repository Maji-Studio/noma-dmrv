import { z } from "zod";
import { readApiSupplierLocationList } from "@/lib/read-models/api-supplier-locations";
import type { ApiContext } from "@/lib/auth/api-context";
import { DomainError } from "@/lib/domain-errors";
import { parseApiQuery, readLookupPage, supplierLocationListSchema } from "./lookup-query";

export async function readSupplierLocationList(request: Request, ctx: ApiContext, supplierId: string) {
  return readSupplierLocationListFromInput(ctx, parseApiQuery(request, supplierLocationListSchema), supplierId);
}

export async function readSupplierLocationListFromInput(ctx: ApiContext, input: z.output<typeof supplierLocationListSchema>, supplierId: string) {
  const { limit, cursor, ...filters } = input;
  if (!z.uuid().safeParse(supplierId).success) throw new DomainError("not_found", "Supplier was not found.");
  return readLookupPage(ctx, "supplier-locations", { limit, cursor, filters: { ...filters, supplierId } },
    readApiSupplierLocationList);
}
