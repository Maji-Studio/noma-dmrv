import type { z } from "zod";
import type { ApiContext } from "@/lib/auth/api-context";
import { readApiBiocharProduct, readApiBiocharProductList } from "@/lib/read-models/api-biochar-products";
import { lookupIdentifier, parseApiQuery, readLookupPage } from "./lookup-query";
import { resourceQueries } from "./query-schemas";

export async function readBiocharProductList(request: Request, ctx: ApiContext) {
  return readBiocharProductListFromInput(ctx, parseApiQuery(request, resourceQueries["biochar-products"].list));
}

export async function readBiocharProductListFromInput(ctx: ApiContext, input: z.output<(typeof resourceQueries)["biochar-products"]["list"]>) {
  const { limit, cursor, ...filters } = input;
  return readLookupPage(ctx, "biochar-products", { limit, cursor, filters }, readApiBiocharProductList);
}

export async function readBiocharProduct(ctx: ApiContext, idOrCode: string) {
  return readApiBiocharProduct(ctx, lookupIdentifier(idOrCode));
}
