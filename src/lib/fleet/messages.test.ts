import { describe, expect, it } from "vitest";
import {
  formatFleetDeleteBlocker,
  formatVehicleTypeLockMessage,
  joinWithAnd,
} from "./messages";

const intakes = { singular: "feedstock intake", plural: "feedstock intakes" };
const deliveries = { singular: "delivery", plural: "deliveries" };

describe("formatFleetDeleteBlocker", () => {
  it("returns null when nothing uses the record", () => {
    expect(formatFleetDeleteBlocker("vehicle", "VEH-001", [{ ...intakes, count: 0 }])).toBeNull();
  });

  it("names the vehicle by code and counts each kind of use", () => {
    expect(
      formatFleetDeleteBlocker("vehicle", "VEH-001", [
        { ...intakes, count: 3 },
        { ...deliveries, count: 1 },
      ]),
    ).toBe(
      "Vehicle VEH-001 was not deleted because 3 feedstock intakes and 1 delivery use it. Choose another vehicle on those records, or keep this one.",
    );
  });

  it("uses the singular verb for one record and skips unused kinds", () => {
    expect(
      formatFleetDeleteBlocker("operator", null, [
        { singular: "production run", plural: "production runs", count: 1 },
        { singular: "production incident", plural: "production incidents", count: 0 },
      ]),
    ).toBe(
      "This operator was not deleted because 1 production run uses it. Choose another operator on those records, or keep this one.",
    );
  });
});

describe("formatVehicleTypeLockMessage", () => {
  it("names the one submitted credit batch", () => {
    expect(formatVehicleTypeLockMessage(["CB-26-001"])).toBe(
      "Cannot update this vehicle because the linked credit batch is locked by a certification submission. Credit batch CB-26-001 uses this vehicle's type. Keep the type, or add a new vehicle for the new type.",
    );
  });

  it("dedupes, sorts and caps the named batches", () => {
    const message = formatVehicleTypeLockMessage([
      "CB-26-004",
      "CB-26-001",
      "CB-26-003",
      "CB-26-001",
      "CB-26-002",
    ]);
    expect(message).toContain("Credit batches CB-26-001, CB-26-002, CB-26-003 and 1 more use this vehicle's type.");
  });
});

describe("joinWithAnd", () => {
  it.each([
    [[], ""],
    [["a"], "a"],
    [["a", "b"], "a and b"],
    [["a", "b", "c"], "a, b and c"],
  ])("joins %j", (items, expected) => {
    expect(joinWithAnd(items)).toBe(expected);
  });
});
