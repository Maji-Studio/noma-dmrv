"use server";

import { getStockAvailability } from "@/data-access/stock-availability";
import { stockAvailabilityRequestSchema } from "@/schemas/stock-availability";
import { withAction } from "./with-action";

export async function getStockAvailabilityFn(input: unknown) {
  return withAction(async (ctx) => {
    const request = stockAvailabilityRequestSchema.parse(input);
    return getStockAvailability(ctx, request);
  }, { fallbackMessage: "Failed to load available stock" });
}
