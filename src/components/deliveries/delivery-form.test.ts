import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./delivery-form.tsx", import.meta.url), "utf8");

describe("DeliveryForm", () => {
  it("omits truck weighing fields", () => {
    expect(source).not.toContain("Truck weighing");
    expect(source).not.toContain("truckMassOnArrivalKg");
    expect(source).not.toContain("truckMassOnDepartureKg");
  });
});
