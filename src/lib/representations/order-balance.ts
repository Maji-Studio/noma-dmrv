import { z } from "zod";
import { ORDER_FULFILLED_SHORTFALL_FRACTION, orderFulfillmentStatuses } from "@/lib/orders/fulfillment";
import { orderQuantityKgSchema } from "./orders";

export const orderBalanceRepresentationSchema = z.object({
  orderId: z.uuid().describe("Order identifier, UUID."),
  quantityKg: orderQuantityKgSchema,
  deliveredWetMassKg: z.number().describe("Sum of delivered wet product kilograms, rounded down to 3 decimal places. Live orders exclude archived deliveries; archived orders include deliveries archived by the facility cascade."),
  remainingWetMassKg: z.number().describe("Requested wet kilograms less delivered wet kilograms, bounded below by zero and rounded down to 3 decimal places. Live orders exclude archived deliveries; archived orders include deliveries archived by the facility cascade. Limited by the order quantity's stored floating-point precision. This is not a stock reservation."),
  fulfillmentStatus: z.enum(orderFulfillmentStatuses).describe(`Derived fulfillment from the same deliveries as the delivered mass: no_deliveries without deliveries, fulfilled at ${(1 - ORDER_FULFILLED_SHORTFALL_FRACTION) * 100}% of requested wet mass or above, otherwise partial.`),
});
export type OrderBalanceRepresentation = z.infer<typeof orderBalanceRepresentationSchema>;

export function representOrderBalance(balance: OrderBalanceRepresentation): OrderBalanceRepresentation {
  return orderBalanceRepresentationSchema.parse(balance);
}
