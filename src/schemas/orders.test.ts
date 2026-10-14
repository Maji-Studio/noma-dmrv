import { describe, expect, it } from "vitest";
import { MASS_INPUT_MAX_KG } from "./helpers";
import { createOrderSchema, orderFormSchema, updateOrderSchema } from "./orders";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("order schemas", () => {
  it("reports a missing form quantity as required at quantityKg", () => {
    const result = orderFormSchema.safeParse({
      facilityId: UUID,
      customerId: UUID,
      formulationId: UUID,
      orderDate: "2026-09-01",
      packaging: "loose",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: ["quantityKg"], message: "Quantity is required" }),
    ]);
  });

  it("drops price and currency from a create payload", () => {
    const parsed = createOrderSchema.parse({
      facilityId: UUID,
      customerId: UUID,
      formulationId: UUID,
      orderDate: "2026-09-01",
      quantityKg: 100,
      packaging: "loose",
      value: 500,
      currency: "KES",
    });
    expect(parsed).not.toHaveProperty("value");
    expect(parsed).not.toHaveProperty("currency");
  });

  it("drops price and currency from an update payload so stored values survive", () => {
    const parsed = updateOrderSchema.parse({ expectedVersion: 1, orderId: UUID, value: 1, currency: "EUR" });
    expect(parsed).toEqual({ orderId: UUID, expectedVersion: 1 });
  });

  for (const [label, schema, base] of [
    ["create", createOrderSchema, { facilityId: UUID, customerId: UUID, formulationId: UUID, quantityKg: 100, packaging: "loose" }],
    ["update", updateOrderSchema, { orderId: UUID, expectedVersion: 1 }],
  ] as const) {
    it(`${label} accepts positive wet kg in 0.001 kg steps up to the shared cap`, () => {
      for (const quantityKg of [0.001, 0.009, 100.125, MASS_INPUT_MAX_KG]) {
        expect(schema.parse({ ...base, orderDate: "2026-10-14", quantityKg }).quantityKg).toBe(quantityKg);
      }
      for (const quantityKg of [0, -1, null, "", Number.NaN, Infinity, MASS_INPUT_MAX_KG + 1, 0.0001, 1.0001]) {
        expect(schema.safeParse({ ...base, orderDate: "2026-10-14", quantityKg }).error?.issues[0].path).toEqual(["quantityKg"]);
      }
      expect(schema.safeParse({ ...base, orderDate: "2026-10-14", quantityKg: 0 }).error?.issues[0].message).toBe("Quantity must be greater than 0");
    });

    it(`${label} decodes real days to UTC midnight and accepts the form's decoded Date`, () => {
      for (const orderDate of ["2024-02-29", "2099-12-31"]) {
        const parsed = schema.parse({ ...base, orderDate });
        expect(parsed.orderDate).toEqual(new Date(`${orderDate}T00:00:00Z`));
        expect(schema.parse(parsed).orderDate).toEqual(parsed.orderDate);
      }
    });

    it(`${label} refuses impossible days and arbitrary instants at the date field`, () => {
      for (const orderDate of ["2026-02-31", "2026-02-29", "2026-10-14T00:00:00Z", "2026-10-14T00:00:00+03:00", "", null, new Date("2026-10-14T12:00:00Z")]) {
        expect(schema.safeParse({ ...base, orderDate }).error?.issues[0]).toMatchObject({ path: ["orderDate"], message: "Enter a valid date." });
      }
    });
  }

  it("requires the create date and leaves a missing PATCH date absent", () => {
    expect(createOrderSchema.safeParse({}).error?.issues).toContainEqual(expect.objectContaining({ path: ["orderDate"] }));
    expect(updateOrderSchema.parse({ orderId: UUID, expectedVersion: 1 })).not.toHaveProperty("orderDate");
    expect(updateOrderSchema.parse({ orderId: UUID, expectedVersion: 1 })).not.toHaveProperty("quantityKg");
  });
});
