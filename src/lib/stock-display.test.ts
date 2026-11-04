import { describe, expect, it } from "vitest";
import { WET_ESTIMATE_DISPLAY_MIN_KG } from "@/config/output-stock";
import { isMassEmpty, isOutputStockEmpty, isWholeKgEmpty } from "./stock-display";

describe("stock display precision", () => {
  it("derives the whole-kg minimum from the wet estimate precision", () => {
    expect(WET_ESTIMATE_DISPLAY_MIN_KG).toBe(0.5);
  });
  it("treats a wet estimate that rounds to zero as empty, and the minimum itself as stock", () => {
    expect(isWholeKgEmpty(0)).toBe(true);
    expect(isWholeKgEmpty(0.49)).toBe(true);
    expect(isWholeKgEmpty(WET_ESTIMATE_DISPLAY_MIN_KG)).toBe(false);
    expect(isWholeKgEmpty(250)).toBe(false);
  });
  it("judges one-decimal figures by the formatter's rounds-to-zero rule", () => {
    expect(isMassEmpty(0)).toBe(true);
    expect(isMassEmpty(0.04)).toBe(true);
    expect(isMassEmpty(0.2)).toBe(false);
    expect(isMassEmpty(12)).toBe(false);
  });
  it("keeps a negative stock visible for reconciling", () => {
    expect(isMassEmpty(-3)).toBe(false);
    expect(isWholeKgEmpty(-3)).toBe(false);
  });
  it("never calls an unknown stock empty", () => {
    expect(isMassEmpty(null)).toBe(false);
    expect(isWholeKgEmpty(undefined)).toBe(false);
    expect(isOutputStockEmpty(null, null)).toBe(false);
  });
  it("judges an output bin by its wet estimate, then its dry biochar", () => {
    expect(isOutputStockEmpty(0.2, 5)).toBe(true);
    expect(isOutputStockEmpty(3, 0)).toBe(false);
    expect(isOutputStockEmpty(null, 0.04)).toBe(true);
    expect(isOutputStockEmpty(null, 0.2)).toBe(false);
  });
});
