import { findApiBiocharProduct, listApiBiocharProducts, type ApiBiocharProductFilters } from "@/data-access/api-biochar-products";
import type { ApiLookupIdentifier } from "@/data-access/api-lookup-filters";
import type { Executor } from "@/data-access/utils";
import type { OrgContext } from "@/lib/auth/server";
import { representBiocharProduct } from "@/lib/representations/biochar-products";
import { readListPage, type ReadListQuery } from "./api-list";

export function readApiBiocharProductList(ctx: OrgContext, query: ReadListQuery<ApiBiocharProductFilters>) {
  return readListPage(ctx, query, listApiBiocharProducts, representBiocharProduct);
}

/** Pass the write transaction to read the saved row, its ingredients and allocations as one snapshot. */
export async function readApiBiocharProduct(ctx: OrgContext, identifier: ApiLookupIdentifier, executor?: Executor) {
  return representBiocharProduct(await findApiBiocharProduct(ctx, identifier, executor));
}
