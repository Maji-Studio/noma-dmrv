import { updateDeliveryInTransaction } from "@/data-access/delivery-output-writes";
import type { Delivery } from "@/db/schema";
import type { OrgContext } from "@/lib/auth/server";
import { updateDeliverySchema } from "@/schemas/deliveries";
import type { z } from "zod";
import { runOperationInProcess, type Operation } from "./runner";

/** UI-only: the delivery row and its latest-entry stock correction commit together. */
const updatePostedDelivery: Operation<typeof updateDeliverySchema, Delivery> = {
  id: "update_posted_delivery",
  input: updateDeliverySchema,
  supportsDryRun: false,
  execute: ({ ctx, tx }, { deliveryId, ...changes }) => updateDeliveryInTransaction(ctx, tx, deliveryId, changes),
};

export async function updateDelivery(ctx: OrgContext, deliveryId: string, changes: Omit<z.input<typeof updateDeliverySchema>, "deliveryId">): Promise<Delivery> {
  return runOperationInProcess(updatePostedDelivery, ctx, { ...changes, deliveryId });
}
