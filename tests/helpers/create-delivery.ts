import type { CreatedDelivery } from "@/data-access/delivery-output-writes";
import type { OrgContext } from "@/lib/auth/server";
import { recordDeliveryForUi } from "@/lib/operations/deliveries";
import { runOperationInProcess } from "@/lib/operations/runner";
import { createDeliverySchema, deliveryOperationInput } from "@/schemas/deliveries";
import type { z } from "zod";

/** Fixtures use the same runner and form contract as the app. */
export async function createDelivery(ctx: OrgContext, raw: z.input<typeof createDeliverySchema>): Promise<CreatedDelivery> {
  const { delivery } = await runOperationInProcess(recordDeliveryForUi, ctx, deliveryOperationInput(createDeliverySchema.parse(raw)));
  return delivery;
}
