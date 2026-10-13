import type { z } from "zod";
import type { ApiContext } from "@/lib/auth/api-context";
import { readApiLabSample, readApiLabSampleList } from "@/lib/read-models/api-lab-samples";
import { lookupIdentifier, parseApiQuery, readLookupPage } from "./lookup-query";
import { resourceQueries } from "./query-schemas";

export async function readLabSampleList(request: Request, ctx: ApiContext) {
  return readLabSampleListFromInput(ctx, parseApiQuery(request, resourceQueries["lab-samples"].list));
}

export async function readLabSampleListFromInput(ctx: ApiContext, input: z.output<(typeof resourceQueries)["lab-samples"]["list"]>) {
  const { limit, cursor, ...filters } = input;
  return readLookupPage(ctx, "lab-samples", { limit, cursor, filters }, readApiLabSampleList);
}

export async function readLabSample(ctx: ApiContext, idOrCode: string) {
  return readApiLabSample(ctx, lookupIdentifier(idOrCode));
}
