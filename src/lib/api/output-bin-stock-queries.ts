import type { z } from "zod";
import { readApiOutputBinStock } from "@/data-access/api-output-bin-stock";
import type { ApiContext } from "@/lib/auth/api-context";
import { representOutputBinStock } from "@/lib/representations/output-bin-stock";
import { lookupIdentifier, parseApiQuery } from "./lookup-query";
import { facilityLookupGetSchema } from "./query-schemas";

export async function readOutputBinStock(request: Request, ctx: ApiContext, storageLocation: string) {
  return readOutputBinStockFromInput(ctx, parseApiQuery(request, facilityLookupGetSchema), storageLocation);
}

/** Both transports return the same finalized representation envelope. */
export async function readOutputBinStockFromInput(ctx: ApiContext, input: z.output<typeof facilityLookupGetSchema>, storageLocation: string) {
  const stock = await readApiOutputBinStock(ctx, { identifier: lookupIdentifier(storageLocation), facilityId: input.facilityId });
  return { data: representOutputBinStock(stock) };
}
