import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DrawOrderArt, FeedstockDrawOrderArt, InOrderBinArt, drawOrderOptions, feedstockDrawOrderOptions, stockModeOptions } from "./stock-mode-art";

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

  it("names the feedstock cards in the operator's words and talks about deliveries", () => {
    const feedstock = stockModeOptions("feedstock_bin");
    expect(feedstock.map((option) => [option.value, option.title])).toEqual([["split", "In order"], ["mix", "Mass weighted"]]);
    for (const option of feedstock) {
      expect(option.description).toContain("deliver");
      expect(option.description).not.toMatch(/sub-bin|batch|run/);
    }
    expect(feedstock[0].description).not.toMatch(/apart/);
  });

  it("uses no en or em dashes", () => {
    for (const type of ["biochar_bin", "product_bin", "feedstock_bin"] as const) {
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

it("offers Oldest first and Newest first for feedstock bins with delivery captions", () => {
  expect(feedstockDrawOrderOptions.map(option => option.title)).toEqual(["Oldest first", "Newest first"]);
  expect(feedstockDrawOrderOptions.map(option => option.value)).toEqual(["oldest_first", "newest_first"]);
  for (const option of feedstockDrawOrderOptions) {
    expect(option.description).toContain("delivery");
    expect(option.description).not.toMatch(/[–—]/);
  }
});

it("draws feedstock cards as one bin of stacked delivery layers, never sub-bins", () => {
  const countBins = (markup: string) => (markup.match(/ V40 H/g) ?? []).length;
  expect(countBins(renderToStaticMarkup(<InOrderBinArt />))).toBe(1);
  for (const order of ["oldest_first", "newest_first"] as const) {
    const markup = renderToStaticMarkup(<FeedstockDrawOrderArt order={order} />);
    expect(countBins(markup)).toBe(1);
    expect(markup).toContain('aria-hidden="true"');
    expect(markup.match(/stock-draw-marker/g)).toHaveLength(1);
    const first = order === "oldest_first" ? "a" : "c";
    expect(markup).toMatch(new RegExp(`class="stock-draw-marker"[^>]*var\\(--stock-batch-${first}\\)`));
    // The drawn layer is gone from the pile: the other two sit from the floor up, leaving the top rows empty.
    expect(markup).not.toContain(`stock-grain-${first}`);
    expect(markup.match(/stock-grain-[abc]/g)).toHaveLength(4 * 15);
    expect([...markup.matchAll(/>(\d+ Oct)<\/text>/g)].map(match => match[1])).toEqual(["01 Oct", "02 Oct", "03 Oct"]);
  }
  const optionArt = (options: { art: unknown }[]) => options.map(option => renderToStaticMarkup(option.art as never));
  expect(optionArt(feedstockDrawOrderOptions).every(markup => countBins(markup) === 1)).toBe(true);
  expect(countBins(optionArt(stockModeOptions("feedstock_bin"))[0])).toBe(1);
});
