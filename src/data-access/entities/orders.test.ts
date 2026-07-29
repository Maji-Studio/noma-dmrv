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
        productMoisturePercent: 15,
        totalDeliveredKg: 100,
        totalDeliveredDryKg: 85,
      }),
    ).toEqual({
      id: "order-1",
      code: "OR-26-001",
      name: "North Farm · Finished product north · May 17, 2026",
      subtitle:
        "Wet biochar product: 900kg | Dry biochar: 765kg remaining",
    });
  });
});
