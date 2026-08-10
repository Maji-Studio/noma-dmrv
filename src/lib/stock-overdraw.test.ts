import { describe, expect, it } from "vitest";
import {
  binStockOverdrawInlineMessage,
  binStockOverdrawMessage,
  deliveryStockOverdrawInlineMessage,
  deliveryStockOverdrawMessage,
  formatStockLimitKg,
  formatStockMinimumKg,
  formatStockKg,
  isStockOverdraw,
  productStockOverdrawMessage,
} from "./stock-overdraw";

describe("stock overdraw", () => {
  it("allows an exact draw and rejects an amount beyond floating-point slack", () => {
    expect(isStockOverdraw(100, 100)).toBe(false);
    expect(isStockOverdraw(100.0000001, 100)).toBe(false);
    expect(isStockOverdraw(100.001, 100)).toBe(true);
  });

  it("builds the shared feedstock-bin message", () => {
    expect(binStockOverdrawMessage("feedstock")).toBe(
      "Not enough wet feedstock in this bin",
    );
  });

  it.each(["biochar", "product"] as const)(
    "uses biochar wording for the %s bin lane",
    (material) => {
      expect(binStockOverdrawMessage(material)).toBe(
        "Not enough biochar in this bin",
      );
    },
  );

  it("builds the product-batch delivery message", () => {
    expect(productStockOverdrawMessage()).toBe(
      "Not enough biochar in this product",
    );
  });

  it("builds the delivery-to-application message", () => {
    expect(deliveryStockOverdrawMessage()).toBe(
      "Not enough biochar in this delivery",
    );
  });

  it("keeps field-level stock messages compact", () => {
    expect(binStockOverdrawInlineMessage("feedstock", 800)).toBe(
      "Only 800 kg of wet feedstock is available. Reduce the wet mass.",
    );
    expect(deliveryStockOverdrawInlineMessage(800)).toBe(
      "Only 800 kg of biochar is available. Reduce the delivered mass.",
    );
  });

  it("never rounds an actionable limit above the available mass", () => {
    expect(formatStockLimitKg(800.99)).toBe("800.9 kg");
    expect(formatStockLimitKg(0.99)).toBe("0.9 kg");
    expect(formatStockLimitKg(-0.4)).toBe("0 kg");
  });

  it("preserves signs outside actionable maximum copy", () => {
    expect(formatStockKg(-0.4)).toBe("-0.4 kg");
  });

  it("never rounds a required minimum below the allocated mass", () => {
    expect(formatStockMinimumKg(60.05)).toBe("60.1 kg");
  });

  it("uses biochar wording for product-bin inline feedback", () => {
    expect(binStockOverdrawInlineMessage("product", 100)).toBe(
      "Only 100 kg of biochar is available. Reduce the mass.",
    );
  });
});
