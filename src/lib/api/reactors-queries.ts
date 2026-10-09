import type { z } from "zod";
import { readApiReactor, readApiReactorList } from "@/lib/read-models/api-reactors";
import type { ApiContext } from "@/lib/auth/api-context";
import { lookupIdentifier, parseApiQuery, readLookupPage } from "./lookup-query";
import { resourceQueries } from "./query-schemas";

export async function readReactorList(request: Request, ctx: ApiContext) {
  return readReactorListFromInput(ctx, parseApiQuery(request, resourceQueries["reactors"].list));
}

export async function readReactorListFromInput(ctx: ApiContext, input: z.output<(typeof resourceQueries)["reactors"]["list"]>) {
  const { limit, cursor, ...filters } = input;
  return readLookupPage(ctx, "reactors", { limit, cursor, filters },
    readApiReactorList);
}

export async function readReactor(request: Request, ctx: ApiContext, idOrCode: string) {
  parseApiQuery(request, resourceQueries.reactors.get);
  return readApiReactor(ctx, lookupIdentifier(idOrCode));
}
