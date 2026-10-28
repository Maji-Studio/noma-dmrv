import { describe, expect, it } from "vitest";
import { IN_USE_DELETE_MARKER, IN_USE_REASON } from "./delete-refusal";
import { customerHasDeliveries, customerLocationHasOrders, customerLocationHasStorageSite, supplierHasIntakes } from "./party-domain-errors";

describe("customer location delete refusals", () => {
  it.each([
    { archived: false, message: "Customer location was not deleted because orders use it. Archive it instead." },
    { archived: true, message: "Customer location was not deleted because orders use it." },
  ])("keeps order metadata and uses archive-appropriate wording (archived=$archived)", ({ archived, message }) => {
    const error = customerLocationHasOrders([{ id: "order-1", code: "ORD-001", facilityId: "facility-1" }], archived);
    expect(error).toMatchObject({ code: "conflict", message });
    expect(error.message).toContain(IN_USE_DELETE_MARKER);
    expect(error.issues).toEqual([{ code: "conflict", path: ["locationId"], message, meta: { orderCodes: ["ORD-001"], orders: [{ id: "order-1", code: "ORD-001", facilityId: "facility-1" }], reason: IN_USE_REASON } }]);
  });

  it.each([
    { archived: false, message: "Customer location was not deleted because it is registered with Isometric as a storage site. Archive it instead." },
    { archived: true, message: "Customer location was not deleted because it is registered with Isometric as a storage site." },
  ])("keeps storage-site refusal details and uses archive-appropriate wording (archived=$archived)", ({ archived, message }) => {
    const error = customerLocationHasStorageSite(archived);
    expect(error).toMatchObject({ code: "conflict", message });
    expect(error.message).toContain(IN_USE_DELETE_MARKER);
    expect(error.issues).toEqual([{ code: "conflict", path: ["locationId"], message, meta: { reason: IN_USE_REASON } }]);
  });

  it("preserves active-location wording and empty order metadata when state is omitted", () => {
    expect(customerLocationHasOrders()).toMatchObject({
      message: "Customer location was not deleted because orders use it. Archive it instead.",
      issues: [{ meta: { orderCodes: [], orders: [] } }],
    });
    expect(customerLocationHasStorageSite().message).toBe("Customer location was not deleted because it is registered with Isometric as a storage site. Archive it instead.");
  });
});

describe("party in-use reference metadata", () => {
  const references = [
    { id: "record-2", code: "REF-001", facilityId: "facility-2" },
    { id: "record-1", code: "REF-002", facilityId: "facility-1" },
  ];

  it("pairs supplier intake ids with the codes in query order", () => {
    expect(supplierHasIntakes(references).issues[0].meta).toEqual({
      reason: IN_USE_REASON, feedstockCodes: ["REF-001", "REF-002"],
      feedstocks: references.map(({ id, code }) => ({ id, code })),
    });
  });

  it("keeps each customer delivery's facility with its id and code", () => {
    expect(customerHasDeliveries(references).issues[0].meta).toEqual({
      reason: IN_USE_REASON, deliveryCodes: ["REF-001", "REF-002"], deliveries: references,
    });
  });

  it("keeps each customer-location order's facility with its id and code", () => {
    expect(customerLocationHasOrders(references).issues[0].meta).toEqual({
      reason: IN_USE_REASON, orderCodes: ["REF-001", "REF-002"], orders: references,
    });
  });

  it("keeps FK fallbacks text-only with empty code and reference arrays", () => {
    expect(supplierHasIntakes().issues[0].meta).toEqual({ reason: IN_USE_REASON, feedstockCodes: [], feedstocks: [] });
    expect(customerHasDeliveries().issues[0].meta).toEqual({ reason: IN_USE_REASON, deliveryCodes: [], deliveries: [] });
    expect(customerLocationHasOrders([], true).issues[0].meta).toEqual({ reason: IN_USE_REASON, orderCodes: [], orders: [] });
  });
});
