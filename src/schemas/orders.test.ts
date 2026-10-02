import { describe, expect, it } from "vitest";
import { createOrderSchema, updateOrderSchema } from "./orders";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("order schemas", () => {
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
    const parsed = updateOrderSchema.parse({ orderId: UUID, value: 1, currency: "EUR" });
    expect(parsed).toEqual({ orderId: UUID });
  });
});
