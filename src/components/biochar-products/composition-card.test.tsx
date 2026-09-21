import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CompositionCard, formatCompositionMass, ingredientComponents } from "./composition-card";
import { StockChangeLabel } from "./stock-context";
import type { AffectedStockPreview } from "@/types/output-stock";

const ingredient = { formulationIngredientId: "ingredient", feedstockTypeId: "feedstock", feedstockTypeName: "Chicken manure", feedstockTypeCategory: "manure", massKg: 100, moistureContentPercent: 30, massDryKg: 80, moistureSource: "operator_override" as const };

describe("Product composition presentation", () => {
  it("uses canonical measured split for new ingredients and frozen dry snapshots for edits", () => {
    expect(ingredientComponents(ingredient).map(component => component.massKg)).toEqual([70, 30]);
    expect(ingredientComponents(ingredient, true).map(component => component.massKg)).toEqual([80, 20]);
    expect(ingredientComponents(ingredient)[0].label).toBe("Chicken manure (dry)");
  });
  it("uses the unrounded stock ratio for weighted ingredients at large masses", () => {
    const stock = { lane: "ingredient", beforeDryKg: 66666666.667, beforeEstimatedWetKg: 100000000 } as AffectedStockPreview;
    const components = ingredientComponents({ ...ingredient, massKg: 100000000, moistureContentPercent: 33.333333, moistureSource: "weighted_remaining" }, false, stock);
    expect(components[0].massKg).toBe(66666666.667);
    expect(components[0].massKg).not.toBe(66666667);
    expect(ingredientComponents({ ...ingredient, moistureSource: "weighted_remaining" })[0].massKg).toBeNull();
  });
  it("does not fabricate missing or invalid dry mass, but accounts for zero additions", () => {
    expect(ingredientComponents({ ...ingredient, moistureContentPercent: null }).map(component => component.massKg)).toEqual([null, null]);
    expect(ingredientComponents({ ...ingredient, massDryKg: 101 }, true).map(component => component.massKg)).toEqual([null, null]);
    expect(ingredientComponents({ ...ingredient, massKg: 0, moistureContentPercent: null }).map(component => component.massKg)).toEqual([0, 0]);
  });
  it("uses total wet mass for every proportion and suppresses charts for missing components", () => {
    const props = { title: "Ingredient composition", totalKg: 100, components: ingredientComponents(ingredient) };
    const html = renderToStaticMarkup(<CompositionCard {...props} />);
    expect(html).toContain("width:70%");
    expect(html).toContain("width:30%");
    const incomplete = renderToStaticMarkup(<CompositionCard {...props} components={ingredientComponents({ ...ingredient, moistureContentPercent: null })} />);
    expect(incomplete).not.toContain("width:");
    expect(incomplete).not.toContain("100%");
    expect(incomplete).toContain("Not available");
  });
  it("keeps positive sub-display-precision quantities distinct from zero", () => {
    expect(formatCompositionMass(0.001)).toBe("<0.1 kg");
    expect(formatCompositionMass(0)).toBe("0 kg");
    expect(formatCompositionMass(Number.NaN)).toBe("Not available");
  });
});

describe("Stock change labels", () => {
  const preview = { removedWetKg: 100, blockingMessage: null } as AffectedStockPreview;
  it("distinguishes wet deductions and additions", () => {
    const source = renderToStaticMarkup(<StockChangeLabel name="Source bin" preview={preview} available />);
    expect(source).toContain("−100 kg wet");
    expect(source).toContain("--st-wait");
    const destination = renderToStaticMarkup(<StockChangeLabel name="Product bin" preview={{ ...preview, removedWetKg: -400 }} available />);
    expect(destination).toContain("+400 kg wet");
    expect(destination).toContain("--st-ok");
  });
  it.each([null, Number.NaN, Number.POSITIVE_INFINITY, 0])("does not advertise invalid mass %s", mass => {
    expect(renderToStaticMarkup(<StockChangeLabel name="Source bin" preview={{ ...preview, removedWetKg: mass }} available />)).not.toContain("kg wet");
  });
  it("hides stale and exceeded projections", () => {
    expect(renderToStaticMarkup(<StockChangeLabel name="Source bin" preview={preview} available={false} />)).not.toContain("kg wet");
    expect(renderToStaticMarkup(<StockChangeLabel name="Source bin" preview={{ ...preview, blockingMessage: "Insufficient stock" }} available />)).not.toContain("kg wet");
  });
});
