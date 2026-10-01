import { describe, expect, it } from "vitest";
import { stockModeOptions } from "./stock-mode-art";

describe("stockModeOptions", () => {
  it("offers Split and Mix with a caption per bin type", () => {
    const biochar = stockModeOptions("biochar_bin");
    const product = stockModeOptions("product_bin");
    expect(biochar.map((option) => option.title)).toEqual(["Split", "Mix"]);
    expect(product.map((option) => option.value)).toEqual(["split", "mix"]);
    for (const [index, option] of biochar.entries()) {
      expect(option.description).toBeTruthy();
      expect(option.description).not.toBe(product[index].description);
    }
    expect(biochar[0].description).toContain("production run");
    expect(product[1].description).toContain("batch");
  });

  it("uses no en or em dashes", () => {
    for (const type of ["biochar_bin", "product_bin"] as const) {
      for (const option of stockModeOptions(type)) expect(option.description).not.toMatch(/[–—]/);
    }
  });
});
