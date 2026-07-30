import { describe, expect, it } from "vitest";
import { toOrderEntityOption } from "./orders";

describe("toOrderEntityOption", () => {
  it("labels the remaining order mass for delivery selection", () => {
    expect(
      toOrderEntityOption({
        id: "order-1",
        code: "OR-26-001",
        orderDate: new Date("2026-05-17T00:00:00.000Z"),
        quantityKg: 1_000,
        customerName: "North Farm",
        productBinName: "Finished product north",
        productMassKg: 1_000,
        productWaterAddedKg: 0,
        productMoisturePercent: 15,
        totalDeliveredKg: 100,
        totalDeliveredDryKg: 85,
        unresolvedDeliveredDryCount: 0,
      }),
    ).toEqual({
      id: "order-1",
      code: "OR-26-001",
      name: "North Farm · Finished product north · May 17, 2026",
      subtitle:
        "Wet biochar product: 900kg | Dry biochar: 765kg remaining",
    });
  });

  it("uses effective blended moisture for remaining dry mass", () => {
    expect(
      toOrderEntityOption({
        id: "order-1",
        code: "OR-26-001",
        orderDate: new Date("2026-05-17T00:00:00.000Z"),
        quantityKg: 100,
        customerName: "North Farm",
        productBinName: "Finished product north",
        productMassKg: 100,
        productWaterAddedKg: 50,
        productMoisturePercent: 10,
        totalDeliveredKg: 0,
        totalDeliveredDryKg: 0,
        unresolvedDeliveredDryCount: 0,
      }).subtitle,
    ).toBe(
      "Wet biochar product: 100kg | Dry biochar: 60kg remaining",
    );
  });

  it("keeps remaining dry mass unknown when a delivery has no dry mass", () => {
    expect(
      toOrderEntityOption({
        id: "order-1",
        code: "OR-26-001",
        orderDate: new Date("2026-05-17T00:00:00.000Z"),
        quantityKg: 100,
        customerName: "North Farm",
        productBinName: "Finished product north",
        productMassKg: 100,
        productWaterAddedKg: 0,
        productMoisturePercent: 10,
        totalDeliveredKg: 10,
        totalDeliveredDryKg: 0,
        unresolvedDeliveredDryCount: 1,
      }).subtitle,
    ).toBe(
      "Wet biochar product: 90kg | Dry biochar: Not recorded remaining",
    );
  });
});
