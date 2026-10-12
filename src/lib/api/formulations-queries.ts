import type { z } from "zod";
import type { ApiContext } from "@/lib/auth/api-context";
import { readApiFormulation, readApiFormulationList } from "@/lib/read-models/api-formulations";
import { lookupIdentifier, parseApiQuery, readLookupPage } from "./lookup-query";
import { resourceQueries } from "./query-schemas";

export async function readFormulationList(request: Request, ctx: ApiContext) {
  return readFormulationListFromInput(ctx, parseApiQuery(request, resourceQueries.formulations.list));
}

export async function readFormulationListFromInput(ctx: ApiContext, input: z.output<(typeof resourceQueries)["formulations"]["list"]>) {
  const { limit, cursor, ...filters } = input;
  return readLookupPage(ctx, "formulations", { limit, cursor, filters }, readApiFormulationList);
}

export async function readFormulation(request: Request, ctx: ApiContext, idOrCode: string) {
  parseApiQuery(request, resourceQueries.formulations.get);
  return readApiFormulation(ctx, lookupIdentifier(idOrCode));
}
