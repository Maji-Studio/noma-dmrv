import { expect, it } from "vitest";
import { orderRepresentationSchema, representOrder } from "./orders";
import { representOrderBalance } from "./order-balance";
import { BODY_HASH_ETAG_PATTERN, bodyHashEtag } from "@/lib/api/etag";
import { ORDER_BALANCE_REPRESENTATION_REVISION } from "@/config/api-rest";

const id = "4d766880-6bb2-4dcb-ad62-e00c04bcbb4b";
const at = "2026-10-08T12:00:00.000Z";
const row = { id, code: "OR-1", version: 1, facilityId: id, customerId: id, customerLocationId: null,
  formulationId: id, orderDate: new Date("2026-09-12T00:00:00Z"), quantityKg: 100, packaging: "loose" as const,
  createdAt: new Date(at), updatedAt: at };

it("publishes only stored fields with a null location and a calendar date", () => {
  const stored = { ...row, organizationId: "hidden", value: 100, currency: "CHF", customerName: "hidden",
    deliveredWetMassKg: 10, fulfillmentStatus: "partial" };
  const data = representOrder(stored);
  expect(data).toEqual({ ...row, orderDate: "2026-09-12", archivedAt: null, createdAt: at });
  expect(Object.keys(data).sort()).toEqual(Object.keys(orderRepresentationSchema.shape).sort());
  expect(data).not.toHaveProperty("value");
  expect(data).not.toHaveProperty("currency");
  expect(representOrder({ ...row, orderDate: "2026-09-12", archivedAt: new Date(at), customerLocationId: id })).toMatchObject({ archivedAt: at, customerLocationId: id, orderDate: "2026-09-12" });
  expect(representOrder({ ...row, orderDate: "0001-01-01" }).orderDate).toBe("0001-01-01");
});

it("keeps the stored real quantity instead of reconstructing the submitted decimal precision", () => {
  const requested = 20000.001;
  const stored = Math.fround(requested);
  expect(stored).not.toBe(requested);
  expect(representOrder({ ...row, quantityKg: stored }).quantityKg).toBe(stored);
  expect(orderRepresentationSchema.shape.quantityKg.description).toContain("32-bit");
  expect(orderRepresentationSchema.shape.quantityKg.description).toContain("0.001 kg steps are not preserved");
});

it("publishes the balance fields and hashes only the finalized published body", () => {
  const data = representOrderBalance({ orderId: id, quantityKg: 100, deliveredWetMassKg: 25, remainingWetMassKg: 75, fulfillmentStatus: "partial" });
  const tag = bodyHashEtag(ORDER_BALANCE_REPRESENTATION_REVISION, data);
  expect(tag).toMatch(BODY_HASH_ETAG_PATTERN);
  expect(bodyHashEtag(ORDER_BALANCE_REPRESENTATION_REVISION, JSON.parse(JSON.stringify(data)))).toBe(tag);
  expect(bodyHashEtag(ORDER_BALANCE_REPRESENTATION_REVISION, { ...data, deliveredWetMassKg: 26, remainingWetMassKg: 74 })).not.toBe(tag);
});
