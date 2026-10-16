import type { ApiContext } from "@/lib/auth/api-context";
import { readApiCustomer } from "@/lib/read-models/api-customers";
import { withCurrentOnStale as withCurrentOnStaleRepresentation } from "./write-checks";

export async function withCurrentOnStale<T>(ctx: ApiContext, id: string, fn: () => Promise<T>): Promise<T> {
  return withCurrentOnStaleRepresentation(fn, { noun: "customer", readCurrent: () => readApiCustomer(ctx, { id }) });
}
