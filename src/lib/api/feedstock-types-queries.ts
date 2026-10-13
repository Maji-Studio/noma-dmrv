import type { z } from "zod";
import { readApiFeedstockType, readApiFeedstockTypeList } from "@/lib/read-models/api-feedstock-types";
import type { ApiContext } from "@/lib/auth/api-context";
import { lookupIdentifier, parseApiQuery, readLookupPage } from "./lookup-query";
import { resourceQueries } from "./query-schemas";

export async function readFeedstockTypeList(request: Request, ctx: ApiContext) {
  return readFeedstockTypeListFromInput(ctx, parseApiQuery(request, resourceQueries["feedstock-types"].list));
}

export async function readFeedstockTypeListFromInput(ctx: ApiContext, input: z.output<(typeof resourceQueries)["feedstock-types"]["list"]>) {
  const { limit, cursor, ...filters } = input;
  return readLookupPage(ctx, "feedstock-types", { limit, cursor, filters },
    readApiFeedstockTypeList);
}

export async function readFeedstockType(request: Request, ctx: ApiContext, idOrCode: string) {
  parseApiQuery(request, resourceQueries["feedstock-types"].get);
  return readApiFeedstockType(ctx, lookupIdentifier(idOrCode));
}
