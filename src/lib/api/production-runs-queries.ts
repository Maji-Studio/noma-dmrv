import type { z } from "zod";
import type { ApiContext } from "@/lib/auth/api-context";
import { readApiProductionRun, readApiProductionRunList } from "@/lib/read-models/api-production-runs";
import { lookupIdentifier, parseApiQuery, readLookupPage } from "./lookup-query";
import { resourceQueries } from "./query-schemas";

export async function readProductionRunList(request: Request, ctx: ApiContext) {
  return readProductionRunListFromInput(ctx, parseApiQuery(request, resourceQueries["production-runs"].list));
}

export async function readProductionRunListFromInput(ctx: ApiContext, input: z.output<(typeof resourceQueries)["production-runs"]["list"]>) {
  const { limit, cursor, ...filters } = input;
  return readLookupPage(ctx, "production-runs", { limit, cursor, filters }, readApiProductionRunList);
}

export async function readProductionRun(ctx: ApiContext, idOrCode: string) {
  return readApiProductionRun(ctx, lookupIdentifier(idOrCode));
}
