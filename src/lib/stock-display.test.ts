import { describe, expect, it } from "vitest";
import { STOCK_DISPLAY_MIN_KG } from "@/config/output-stock";
import { isStockBelowDisplay, stockBasisKg } from "./stock-display";

describe("stock display minimum", () => {
  it("treats nothing and sub-display residues as empty, and the minimum itself as stock", () => {
    expect(isStockBelowDisplay(0)).toBe(true);
    expect(isStockBelowDisplay(STOCK_DISPLAY_MIN_KG - 0.01)).toBe(true);
    expect(isStockBelowDisplay(STOCK_DISPLAY_MIN_KG)).toBe(false);
    expect(isStockBelowDisplay(250)).toBe(false);
  });
  it("keeps a negative stock visible for reconciling", () => {
    expect(isStockBelowDisplay(-3)).toBe(false);
  });
  it("never calls an unknown stock empty", () => {
    expect(isStockBelowDisplay(null)).toBe(false);
    expect(isStockBelowDisplay(undefined)).toBe(false);
  });
  it("judges a bin by its wet mass, then its dry biochar", () => {
    expect(stockBasisKg(0.2, 5)).toBe(0.2);
    expect(stockBasisKg(null, 5)).toBe(5);
    expect(stockBasisKg(null, null)).toBeNull();
  });
});
