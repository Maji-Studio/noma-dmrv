import { describe, expect, it } from "vitest";
import { toOrderEntityOption } from "./orders";

const REQUEST = { id: "order-1", code: "OR-26-001", customerName: "North Farm", formulationName: "Compost blend", quantityKg: 1_000, totalDeliveredKg: 100 };

describe("toOrderEntityOption", () => {
  it("labels the formulation request and remaining wet mass", () => {
    expect(toOrderEntityOption(REQUEST)).toEqual({
      id: REQUEST.id, code: REQUEST.code, name: "North Farm · Compost blend",
      remainingMass: { wetKg: 900, dryKg: null },
      subtitle: "Requested wet mass remaining: 900 kg",
    });
  });
  it("does not reserve dry stock for an unfulfilled request", () => {
    expect(toOrderEntityOption({ ...REQUEST, totalDeliveredKg: 0 }).remainingMass).toEqual({ wetKg: 1_000, dryKg: null });
  });
  it("subtracts posted deliveries from requested wet mass", () => {
    expect(toOrderEntityOption({ ...REQUEST, totalDeliveredKg: 250 }).remainingMass).toEqual({ wetKg: 750, dryKg: null });
  });
  it("clamps fulfilled requests at zero", () => {
    expect(toOrderEntityOption({ ...REQUEST, totalDeliveredKg: 1_100 }).remainingMass).toEqual({ wetKg: 0, dryKg: null });
  });
  it("omits missing labels without adding separators", () => {
    expect(toOrderEntityOption({ ...REQUEST, customerName: null }).name).toBe("Compost blend");
    expect(toOrderEntityOption({ ...REQUEST, formulationName: null }).name).toBe("North Farm");
  });
});
