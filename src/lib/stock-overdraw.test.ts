import { describe, expect, it } from "vitest";
import {
  binStockOverdrawMessage,
  deliveryStockOverdrawMessage,
  isStockOverdraw,
} from "./stock-overdraw";

describe("stock overdraw", () => {
  it("allows an exact draw and rejects an amount beyond floating-point slack", () => {
    expect(isStockOverdraw(100, 100)).toBe(false);
    expect(isStockOverdraw(100.0000001, 100)).toBe(false);
    expect(isStockOverdraw(100.001, 100)).toBe(true);
  });

  it("builds the shared inline bin message", () => {
    expect(binStockOverdrawMessage("feedstock", 100, 180)).toBe(
      "Not enough feedstock in this bin — 100 kg available but this draw needs 180 kg. Reconcile the bin's stock (Storage Bins → the bin → Reconcile stock), then try again.",
    );
  });

  it("builds the inline delivery message", () => {
    expect(deliveryStockOverdrawMessage("BP-001", 100, 120)).toBe(
      "Cannot deliver 120 kg from product BP-001: only 100 kg remain undelivered. Reconcile the source bin or adjust the product before delivering.",
    );
  });
});
