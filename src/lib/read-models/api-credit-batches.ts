import { findApiCreditBatch, listApiCreditBatches, type ApiCreditBatchFilters } from "@/data-access/api-credit-batches";
import type { ApiLookupIdentifier } from "@/data-access/api-lookup-filters";
import type { OrgContext } from "@/lib/auth/server";
import { representCreditBatch } from "@/lib/representations/credit-batches";
import { readListPage, type ReadListQuery } from "./api-list";

export function readApiCreditBatchList(ctx: OrgContext, query: ReadListQuery<ApiCreditBatchFilters>) {
  return readListPage(ctx, query, listApiCreditBatches, representCreditBatch);
}

export async function readApiCreditBatch(ctx: OrgContext, identifier: ApiLookupIdentifier) {
  return representCreditBatch(await findApiCreditBatch(ctx, identifier));
}
