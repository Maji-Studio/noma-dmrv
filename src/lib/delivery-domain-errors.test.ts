import { describe, expect, it } from "vitest";
import { deliveryBalanceExceeded, deliveryReferenceNotFound, deliveryValidationFailed } from "./delivery-domain-errors";

describe("delivery domain errors", () => {
  it.each(["orderId", "storageLocationId", "driverId", "vehicleId", "deliveryId"])("hides foreign and missing %s", field => {
    expect(deliveryReferenceNotFound([field], "Record")).toMatchObject({ code: "not_found", message: "Record was not found.", issues: [{ path: [field], code: "not_found" }] });
  });
  it("preserves the source array pointer", () => {
    expect(deliveryReferenceNotFound(["sources", 2, "layerId"], "Product")).toMatchObject({ code: "not_found", issues: [{ path: ["sources", 2, "layerId"] }] });
    expect(deliveryValidationFailed(["sources", 2, "layerId"], "Product was placed after this delivery.")).toMatchObject({ code: "validation_failed", issues: [{ path: ["sources", 2, "layerId"] }] });
  });
  it("puts the exact wet balance in issue metadata", () => {
    expect(deliveryBalanceExceeded(10, 10.001)).toMatchObject({ code: "conflict", issues: [{ path: ["deliveredWetMassKg"], meta: { measure: "order_remaining_wet", availableWetKg: 10, requestedWetKg: 10.001, unit: "kg" } }] });
  });
});

it("preserves the balance meta and pointer across the action boundary", async () => {
  const { toActionFailure } = await import("@/fn/action-errors");
  const { actionFailureResponse } = await import("@/lib/api/problem");
  const failure = toActionFailure(deliveryBalanceExceeded(10, 10.001), { fallbackMessage: "Delivery was not created.", log: { message: "delivery test" } });
  const response = actionFailureResponse(failure, "/deliveries", "request");
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ errors: [{ pointer: "/deliveredWetMassKg", meta: { measure: "order_remaining_wet", availableWetKg: 10, requestedWetKg: 10.001, unit: "kg" } }] });
});
