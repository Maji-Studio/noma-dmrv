import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DrawOrderArt, drawOrderOptions, stockModeOptions } from "./stock-mode-art";

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

it("shows dated decorative bays with the chosen first bay empty at rest", () => {
  expect(drawOrderOptions.map(option => option.title)).toEqual(["Oldest first", "Newest first"]);
  for (const order of ["oldest_first", "newest_first"] as const) {
    const markup = renderToStaticMarkup(<DrawOrderArt order={order} />);
    expect(markup).toContain('aria-hidden="true"');
    expect(markup.match(/stock-draw-first/g)).toHaveLength(1);
    const bayClasses = [...markup.matchAll(/class="(stock-draw-first|stock-draw-waiting)"/g)].map(match => match[1]);
    expect(bayClasses[order === "oldest_first" ? 0 : 2]).toBe("stock-draw-first");
    expect([...markup.matchAll(/>(\d+ Oct)<\/text>/g)].map(match => match[1])).toEqual(["01 Oct", "02 Oct", "03 Oct"]);
  }
});
