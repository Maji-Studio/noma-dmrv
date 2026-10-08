import { readApiFeedstockType, readApiFeedstockTypeList } from "@/lib/read-models/api-feedstock-types";
import type { ApiContext } from "@/lib/auth/api-context";
import { lookupIdentifier, parseApiQuery, readLookupPage } from "./lookup-query";
import { resourceQueries } from "./query-schemas";

export async function readFeedstockTypeList(request: Request, ctx: ApiContext) {
  const { limit, cursor, ...filters } = parseApiQuery(request, resourceQueries["feedstock-types"].list);
  return readLookupPage(ctx, "feedstock-types", { limit, cursor, filters },
    readApiFeedstockTypeList);
}

export async function readFeedstockType(request: Request, ctx: ApiContext, idOrCode: string) {
  parseApiQuery(request, resourceQueries["feedstock-types"].get);
  return readApiFeedstockType(ctx, lookupIdentifier(idOrCode));
}
