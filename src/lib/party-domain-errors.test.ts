import { describe, expect, it } from "vitest";
import { BLOCKER_LIMIT } from "@/config/party-input";
import { IN_USE_DELETE_MARKER, IN_USE_REASON } from "./delete-refusal";
import { CUSTOMER_DELIVERIES_REASON, SUPPLIER_INTAKES_REASON, customerHasDeliveries, customerLocationHasOrders, customerLocationHasStorageSite, supplierHasIntakes } from "./party-domain-errors";

const OVERFLOW_COUNT = 2;

describe("customer location delete refusals", () => {
  it.each([
    { archived: false, message: "Customer location was not deleted because orders use it: ORD-001. Archive it instead." },
    { archived: true, message: "Customer location was not deleted because orders use it: ORD-001." },
  ])("keeps order metadata and uses archive-appropriate wording (archived=$archived)", ({ archived, message }) => {
    const error = customerLocationHasOrders([{ id: "order-1", code: "ORD-001", facilityId: "facility-1" }], archived);
    expect(error).toMatchObject({ code: "conflict", message });
    expect(error.message).toContain(IN_USE_DELETE_MARKER);
    expect(error.issues).toEqual([{ code: "conflict", path: ["locationId"], message, meta: { orderCount: 1, orderCodes: ["ORD-001"], orders: [{ id: "order-1", code: "ORD-001", facilityId: "facility-1" }], reason: IN_USE_REASON } }]);
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

  it("keeps each supplier intake's facility with its id and code", () => {
    expect(supplierHasIntakes(references).issues[0].meta).toEqual({
      reason: IN_USE_REASON, feedstockCount: references.length, feedstockCodes: ["REF-001", "REF-002"], feedstocks: references,
    });
  });

  it("keeps each customer delivery's facility with its id and code", () => {
    expect(customerHasDeliveries(references).issues[0].meta).toEqual({
      reason: IN_USE_REASON, deliveryCount: references.length, deliveryCodes: ["REF-001", "REF-002"], deliveries: references,
    });
  });

  it("keeps each customer-location order's facility with its id and code", () => {
    expect(customerLocationHasOrders(references).issues[0].meta).toEqual({
      reason: IN_USE_REASON, orderCount: references.length, orderCodes: ["REF-001", "REF-002"], orders: references,
    });
  });

  it("keeps FK fallbacks text-only with empty code and reference arrays", () => {
    expect(supplierHasIntakes().issues[0].meta).toEqual({ reason: IN_USE_REASON, feedstockCodes: [], feedstocks: [] });
    expect(customerHasDeliveries().issues[0].meta).toEqual({ reason: IN_USE_REASON, deliveryCodes: [], deliveries: [] });
    expect(customerLocationHasOrders([], true).issues[0].meta).toEqual({ reason: IN_USE_REASON, orderCodes: [], orders: [] });
  });
});
describe.each([
  { noun: "Supplier", reason: SUPPLIER_INTAKES_REASON, recovery: " Review the linked intakes or keep this supplier.", countKey: "feedstockCount", codesKey: "feedstockCodes", refsKey: "feedstocks", refuse: supplierHasIntakes },
  { noun: "Customer", reason: CUSTOMER_DELIVERIES_REASON, recovery: " Archive it instead.", countKey: "deliveryCount", codesKey: "deliveryCodes", refsKey: "deliveries", refuse: customerHasDeliveries },
  ...[false, true].map(archived => ({ noun: "Customer location", reason: "orders use it", recovery: archived ? "" : " Archive it instead.", countKey: "orderCount", codesKey: "orderCodes", refsKey: "orders",
    refuse: (records: Parameters<typeof customerLocationHasOrders>[0], total?: number) => customerLocationHasOrders(records, archived, total) })),
])("$noun blocker overflow (recovery=$recovery)", ({ noun, reason, recovery, countKey, codesKey, refsKey, refuse }) => {
  it.each([BLOCKER_LIMIT, BLOCKER_LIMIT + OVERFLOW_COUNT])("names capped records and reports the exact total %s", total => {
    const records = Array.from({ length: total }, (_, index) => ({ id: `record-${index}`, code: `REF-${index + 1}`, facilityId: "facility-1" }));
    const named = records.slice(0, BLOCKER_LIMIT);
    const list = total === BLOCKER_LIMIT ? "REF-1, REF-2, REF-3, REF-4 and REF-5" : "REF-1, REF-2, REF-3, REF-4, REF-5 and 2 more";
    const message = `${noun} was not deleted because ${reason}: ${list}.${recovery}`;
    const error = refuse(named, total);
    expect(error).toMatchObject({ code: "conflict", message });
    expect(error.issues[0]).toMatchObject({ code: "conflict", message });
    expect(error.issues[0].meta).toEqual({ reason: IN_USE_REASON, [countKey]: total, [codesKey]: named.map(row => row.code), [refsKey]: named });
    expect(refuse(records).issues).toEqual(error.issues);
  });

  it("does not undercount supplied records", () => {
    const records = [{ id: "record-1", code: "REF-1", facilityId: "facility-1" }];
    expect(refuse(records, 0).issues[0].meta?.[countKey]).toBe(records.length);
  });
});
