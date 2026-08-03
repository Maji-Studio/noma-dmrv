import { describe, expect, it } from "vitest";
import {
  deliveryOrderBalanceMessage,
  isDeliveryOrderBalanceMessage,
} from "./delivery-order-balance";

describe("delivery order balance copy", () => {
  it("formats an actionable limit without rounding above availability", () => {
    const message = deliveryOrderBalanceMessage(800.99);

    expect(message).toBe(
      "Only 800.9 kg remains on this order. Reduce the delivered mass.",
    );
    expect(isDeliveryOrderBalanceMessage(message)).toBe(true);
  });

  it("clamps a negative remaining balance to zero", () => {
    expect(deliveryOrderBalanceMessage(-0.4)).toBe(
      "Only 0 kg remains on this order. Reduce the delivered mass.",
    );
  });

  it("does not route unrelated server errors as order-balance feedback", () => {
    expect(isDeliveryOrderBalanceMessage("Not enough biochar in this product"))
      .toBe(false);
  });
});
