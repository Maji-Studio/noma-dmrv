import { describe, expect, it } from "vitest";
import { updateSampleSchema, deleteSampleSchema } from "./samples";
import { updateOrderSchema, deleteOrderSchema } from "./orders";
import { updateDeliverySchema, deleteDeliverySchema } from "./deliveries";
import { updateTransportLegSchema, deleteTransportLegSchema } from "./transport-legs";
import { updateApplicationSchema, deleteApplicationSchema } from "./applications";
import { updateCreditBatchSchema, deleteCreditBatchSchema } from "./credit-batches";
const ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const INITIAL_VERSION = 1;
const cases = [
  ["update Sample", updateSampleSchema, { sampleId: ID }],
  ["delete Sample", deleteSampleSchema, { sampleId: ID }],
  ["update Order", updateOrderSchema, { orderId: ID }],
  ["delete Order", deleteOrderSchema, { orderId: ID }],
  ["update Delivery", updateDeliverySchema, { deliveryId: ID }],
  ["delete Delivery", deleteDeliverySchema, { deliveryId: ID }],
  ["update TransportLeg", updateTransportLegSchema, { id: ID, distanceKm: 10, loadMassKg: 1 }],
  ["delete TransportLeg", deleteTransportLegSchema, { id: ID }],
  ["update Application", updateApplicationSchema, { applicationId: ID }],
  ["delete Application", deleteApplicationSchema, { applicationId: ID }],
  ["update CreditBatch", updateCreditBatchSchema, { creditBatchId: ID }],
  ["delete CreditBatch", deleteCreditBatchSchema, { creditBatchId: ID }],
 ] as const;
describe.each(cases)("%s precondition", (_name, schema, identity) => {
  it("requires a positive integer without coercion", () => {
    for (const expectedVersion of [undefined, null, 0, -1, 1.5, "1"]) {
      expect(schema.safeParse({ ...identity, expectedVersion }).success).toBe(false);
    }
    expect(schema.parse({ ...identity, expectedVersion: INITIAL_VERSION }).expectedVersion).toBe(INITIAL_VERSION);
  });
});
