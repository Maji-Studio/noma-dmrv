import { z } from "zod";
import { readApiSupplierLocationList } from "@/lib/read-models/api-supplier-locations";
import type { ApiContext } from "@/lib/auth/api-context";
import { DomainError } from "@/lib/domain-errors";
import { parseApiQuery, readLookupPage, supplierLocationListSchema } from "./lookup-query";

export async function readSupplierLocationList(request: Request, ctx: ApiContext, supplierId: string) {
  const { limit, cursor, ...filters } = parseApiQuery(request, supplierLocationListSchema);
  if (!z.uuid().safeParse(supplierId).success) throw new DomainError("not_found", "Supplier was not found.");
  return readLookupPage(ctx, "supplier-locations", { limit, cursor, filters: { ...filters, supplierId } },
    readApiSupplierLocationList);
}
