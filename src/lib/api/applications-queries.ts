import type { z } from "zod";
import { readApiApplication, readApiApplicationList, readApiApplicationBoundary } from "@/lib/read-models/api-applications";
import type { ApiContext } from "@/lib/auth/api-context";
import { lookupIdentifier, parseApiQuery, readLookupPage } from "./lookup-query";
import { resourceQueries } from "./query-schemas";

export async function readApplicationList(request: Request, ctx: ApiContext) {
  return readApplicationListFromInput(ctx, parseApiQuery(request, resourceQueries.applications.list));
}
export async function readApplicationListFromInput(ctx: ApiContext, input: z.output<typeof resourceQueries.applications.list>) {
  const { limit, cursor, ...filters } = input;
  return readLookupPage(ctx, "applications", { limit, cursor, filters }, readApiApplicationList);
}
export async function readApplication(request: Request, ctx: ApiContext, idOrCode: string) {
  parseApiQuery(request, resourceQueries.applications.get);
  return readApiApplication(ctx, lookupIdentifier(idOrCode));
}
export async function readApplicationBoundary(request: Request, ctx: ApiContext, idOrCode: string) {
  parseApiQuery(request, resourceQueries.applications.get);
  return readApiApplicationBoundary(ctx, lookupIdentifier(idOrCode));
}
