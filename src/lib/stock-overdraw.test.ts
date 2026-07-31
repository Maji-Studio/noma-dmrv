import { describe, expect, it } from "vitest";
import {
  binStockOverdrawInlineMessage,
  binStockOverdrawMessage,
  deliveryStockOverdrawInlineMessage,
  deliveryStockOverdrawMessage,
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
      "Not enough feedstock in this bin",
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
      "Only 800 kg of feedstock is available. Reduce the mass.",
    );
    expect(deliveryStockOverdrawInlineMessage(800)).toBe(
      "Only 800 kg of product is available. Reduce the delivered mass.",
    );
  });
});
