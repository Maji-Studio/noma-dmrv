import type { ApiContext } from "@/lib/auth/api-context";
import { readApiFormulation } from "@/lib/read-models/api-formulations";
import { withCurrentOnStale as withCurrentOnStaleRepresentation } from "./write-checks";

export async function withCurrentOnStale<T>(ctx: ApiContext, id: string, fn: () => Promise<T>): Promise<T> {
  return withCurrentOnStaleRepresentation(fn, { noun: "formulation", readCurrent: () => readApiFormulation(ctx, { id }) });
}
