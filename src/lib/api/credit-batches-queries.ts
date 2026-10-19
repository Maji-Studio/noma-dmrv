import type { z } from "zod";
import type { ApiContext } from "@/lib/auth/api-context";
import { readApiCreditBatch, readApiCreditBatchList } from "@/lib/read-models/api-credit-batches";
import { lookupIdentifier, parseApiQuery, readLookupPage } from "./lookup-query";
import { resourceQueries } from "./query-schemas";

export async function readCreditBatchList(request: Request, ctx: ApiContext) {
  return readCreditBatchListFromInput(ctx, parseApiQuery(request, resourceQueries["credit-batches"].list));
}

export async function readCreditBatchListFromInput(ctx: ApiContext, input: z.output<(typeof resourceQueries)["credit-batches"]["list"]>) {
  const { limit, cursor, ...filters } = input;
  return readLookupPage(ctx, "credit-batches", { limit, cursor, filters }, readApiCreditBatchList);
}

export async function readCreditBatch(ctx: ApiContext, idOrCode: string) {
  return readApiCreditBatch(ctx, lookupIdentifier(idOrCode));
}
