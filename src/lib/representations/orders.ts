import { z } from "zod";
import { packagingTypes } from "@/schemas/orders";
import { lookupFields, lookupInstants, lookupVersion, type LookupRepresentationInput } from "./lookup-fields";

export const orderQuantityKgSchema = z.number().describe("Requested product mass in wet kilograms, as stored in a 32-bit floating-point real column. Precision is about 6 significant decimal digits; 0.001 kg steps are not preserved at large quantities. An order does not reserve stock.");
export const orderRepresentationSchema = z.object({
  ...lookupFields,
  version: lookupVersion,
  facilityId: z.uuid().describe("Owning facility identifier, UUID."),
  customerId: z.uuid().describe("Customer identifier, UUID."),
  customerLocationId: z.uuid().nullable().describe("Destination customer location identifier, UUID, or null when unspecified."),
  formulationId: z.uuid().describe("Ordered formulation identifier, UUID."),
  orderDate: z.iso.date().describe("Order business date, YYYY-MM-DD. A calendar date, not an event instant."),
  quantityKg: orderQuantityKgSchema,
  packaging: z.enum(packagingTypes).describe("Packaging: loose or bagged."),
}).omit({ name: true });
export type OrderRepresentation = z.infer<typeof orderRepresentationSchema>;
export type OrderRepresentationInput = LookupRepresentationInput<Omit<OrderRepresentation, "orderDate">> & { orderDate: Date | string };

/** Only order-owned fields; fulfillment lives in the separate balance read. */
export function representOrder(row: OrderRepresentationInput): OrderRepresentation {
  return orderRepresentationSchema.parse({ ...row, ...lookupInstants(row), orderDate: new Date(row.orderDate).toISOString().slice(0, "YYYY-MM-DD".length) });
}
