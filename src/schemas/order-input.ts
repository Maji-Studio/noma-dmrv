import { z } from "zod";
import { calendarDateSchema, expectedVersionSchema, MASS_KG_INPUT_STEP, uuidSchema } from "./helpers";
import { orderCustomerLocationIdSchema, orderQuantityKgSchema, packagingTypes, updateOrderSchema } from "./orders";

const fields = {
  facilityId: uuidSchema().describe("Facility the order is placed at, UUID. Must be active."),
  customerId: uuidSchema().describe("Customer the product is ordered for, UUID."),
  customerLocationId: orderCustomerLocationIdSchema.describe("Required customer location UUID for the delivery destination. Must belong to the customer."),
  formulationId: uuidSchema().describe("Formulation ordered, UUID. One formulation per order."),
  orderDate: calendarDateSchema().describe("Order business date, YYYY-MM-DD. Any real calendar day is accepted."),
  quantityKg: orderQuantityKgSchema
    .describe(`Requested product mass in wet kg as ordered, at least ${MASS_KG_INPUT_STEP} kg. An order does not reserve stock.`),
  packaging: z.enum(packagingTypes).optional().describe("Packaging: loose or bagged. If omitted on create, the server uses the Organization setting."),
};

/** Like product and lab Sample creates, the server generates the code. */
export const recordOrderInput = z.strictObject(fields);
export type RecordOrderInput = z.output<typeof recordOrderInput>;

/** Decode only: the writer validates the merged state against the locked order. */
const updateFields = {
  code: updateOrderSchema.shape.code.describe("Human-readable order code: capital letters, digits and hyphens."),
  facilityId: fields.facilityId.optional(),
  customerId: fields.customerId.optional(),
  customerLocationId: fields.customerLocationId.optional().describe("Customer location UUID for the delivery destination. Omit to keep the stored location. Cannot be cleared."),
  formulationId: fields.formulationId.optional(),
  orderDate: fields.orderDate.optional(),
  quantityKg: fields.quantityKg.optional(),
  packaging: fields.packaging.describe("Loose or bagged. Omit to keep the stored packaging."),
};

/** REST PATCH body; its target and version come from the path and If-Match. */
export const updateOrderApiInput = z.strictObject(updateFields);

/** MCP and in-process input, where there is no path or If-Match header. */
export const updateOrderInput = z.strictObject({
  orderId: uuidSchema().describe("Target order UUID."),
  expectedVersion: expectedVersionSchema.describe("Version from get_order."),
  ...updateFields,
});
export type UpdateOrderInput = z.output<typeof updateOrderInput>;

/** An order can be deleted only while it has no deliveries, including archived deliveries. */
export const deleteOrderInput = z.strictObject({
  orderId: uuidSchema().describe("Target order UUID."),
  expectedVersion: expectedVersionSchema.describe("Version from get_order."),
});
export type DeleteOrderInput = z.output<typeof deleteOrderInput>;
