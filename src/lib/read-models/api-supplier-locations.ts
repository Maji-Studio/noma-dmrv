import { listApiSupplierLocations } from "@/data-access/api-supplier-locations";
import type { OrgContext } from "@/lib/auth/server";
import { representSupplierLocation } from "@/lib/api/representations/supplier-locations";
import { readListPage, type ReadListQuery } from "./api-list";

export function readApiSupplierLocationList(ctx: OrgContext, query: ReadListQuery<{ supplierId: string; q?: string }>) {
  return readListPage(ctx, query, listApiSupplierLocations, representSupplierLocation);
}
