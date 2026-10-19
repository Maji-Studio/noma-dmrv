import type { z } from "zod";
import { requireApiOutputBin } from "@/data-access/api-output-stock-movements";
import type { ApiContext } from "@/lib/auth/api-context";
import { readApiOutputStockMovementList } from "@/lib/read-models/api-output-stock-movements";
import { lookupIdentifier, parseApiQuery, readLookupPage } from "./lookup-query";
import { outputStockMovementListSchema } from "./query-schemas";

export async function readOutputStockMovementList(request: Request, ctx: ApiContext, idOrCode: string) {
  return readOutputStockMovementListFromInput(ctx, parseApiQuery(request, outputStockMovementListSchema), idOrCode);
}

/** The bin resolves by id or code; the cursor binds the resolved id so both spellings share it. */
export async function readOutputStockMovementListFromInput(ctx: ApiContext, input: z.output<typeof outputStockMovementListSchema>, idOrCode: string) {
  const { limit, cursor } = input;
  const bin = await requireApiOutputBin(ctx, lookupIdentifier(idOrCode));
  return readLookupPage(ctx, "output-stock-movements", { limit, cursor, filters: { storageLocationId: bin.id } }, readApiOutputStockMovementList);
}
