import type { ApiContext } from "@/lib/auth/api-context";
import { readApiSupplier } from "@/lib/read-models/api-suppliers";
import { withCurrentOnStale as withCurrentOnStaleRepresentation } from "./write-checks";

export async function withCurrentOnStale<T>(ctx: ApiContext, id: string, fn: () => Promise<T>): Promise<T> {
  return withCurrentOnStaleRepresentation(fn, { noun: "supplier", readCurrent: () => readApiSupplier(ctx, { id }) });
}
