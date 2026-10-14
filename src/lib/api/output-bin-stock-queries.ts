import type { z } from "zod";
import type { ApiContext } from "@/lib/auth/api-context";
import { readApiOutputBinStock } from "@/lib/read-models/api-output-bin-stock";
import { lookupIdentifier, parseApiQuery } from "./lookup-query";
import { facilityLookupGetSchema } from "./query-schemas";

export async function readOutputBinStock(request: Request, ctx: ApiContext, storageLocation: string) {
  return readOutputBinStockFromInput(ctx, parseApiQuery(request, facilityLookupGetSchema), storageLocation);
}

export async function readOutputBinStockFromInput(ctx: ApiContext, input: z.output<typeof facilityLookupGetSchema>, storageLocation: string) {
  return readApiOutputBinStock(ctx, { identifier: lookupIdentifier(storageLocation), facilityId: input.facilityId });
}
