import { findApiSupplier, listApiSuppliers } from "@/data-access/api-suppliers";
import type { ApiLookupFilters, ApiLookupIdentifier } from "@/data-access/api-lookup-filters";
import type { OrgContext } from "@/lib/auth/server";
import { representSupplier } from "@/lib/api/representations/suppliers";
import { readListPage, type ReadListQuery } from "./api-list";

export function readApiSupplierList(ctx: OrgContext, query: ReadListQuery<ApiLookupFilters>) {
  return readListPage(ctx, query, listApiSuppliers, representSupplier);
}

export async function readApiSupplier(ctx: OrgContext, identifier: ApiLookupIdentifier) {
  return representSupplier(await findApiSupplier(ctx, identifier));
}
