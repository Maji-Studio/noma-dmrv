import { describe, expect, it } from "vitest";
import type { AffectedStockPreview } from "@/types/output-stock";
import {
  ingredientComponents,
  productCompositionComponents,
  sourceComponents,
} from "./product-composition-components";

const ingredient = {
  formulationIngredientId: "ingredient",
  feedstockTypeId: "feedstock",
  feedstockTypeName: "Chicken manure",
  feedstockTypeCategory: "manure",
  massKg: 100,
  moistureContentPercent: 30,
  massDryKg: 80,
  moistureSource: "operator_override" as const,
};

const masses = (components: { massKg: number | null }[]) => components.map((component) => component.massKg);

describe("ingredientComponents", () => {
  it("splits at measured moisture for a new product and keeps the dry snapshot on a saved one", () => {
    expect(masses(ingredientComponents(ingredient))).toEqual([70, 30]);
    expect(masses(ingredientComponents(ingredient, { frozen: true }))).toEqual([80, 20]);
    expect(ingredientComponents(ingredient)[0].label).toBe("Chicken manure solids");
    expect(ingredientComponents(ingredient)[1].label).toBe("Water in chicken manure");
  });

  it("uses the unrounded stock ratio for weighted ingredients at large masses", () => {
    const stock = { lane: "ingredient", beforeDryKg: 66666666.667, beforeEstimatedWetKg: 100000000 } as AffectedStockPreview;
    const components = ingredientComponents(
      { ...ingredient, massKg: 100000000, moistureContentPercent: 33.333333, moistureSource: "weighted_remaining" },
      { stock },
    );
    expect(components[0].massKg).toBe(66666666.667);
    expect(components[0].massKg).not.toBe(66666667);
  });

  it("does not fabricate a weighted split without the stock projection", () => {
    expect(ingredientComponents({ ...ingredient, moistureSource: "weighted_remaining" })[0].massKg).toBeNull();
    const productLane = { lane: "product", beforeDryKg: 50, beforeEstimatedWetKg: 100 } as AffectedStockPreview;
    expect(ingredientComponents({ ...ingredient, moistureSource: "weighted_remaining" }, { stock: productLane })[0].massKg).toBeNull();
  });

  it("does not fabricate missing or invalid dry mass, but accounts for zero additions", () => {
    expect(masses(ingredientComponents({ ...ingredient, moistureContentPercent: null }))).toEqual([null, null]);
    expect(masses(ingredientComponents({ ...ingredient, massDryKg: 101 }, { frozen: true }))).toEqual([null, null]);
    expect(masses(ingredientComponents({ ...ingredient, massKg: 0, moistureContentPercent: null }))).toEqual([0, 0]);
  });
});

describe("productCompositionComponents", () => {
  it("files ingredient water with the biochar water, so ingredients stop counting as pure solids", () => {
    // 700 kg wet biochar at 14.3% moisture is 600 kg dry; 240 kg compost at
    // 20.8% is 190 kg solids and 50 kg water; 160 kg water added.
    const source = sourceComponents({ wetKg: 700, dryKg: 600, addedWaterKg: 160 });
    const compost = ingredientComponents({ ...ingredient, feedstockTypeName: "Compost", massKg: 240, moistureContentPercent: 20.8333333333 });
    const product = productCompositionComponents(source, compost);

    expect(product.map((component) => component.label)).toEqual(["Dry biochar", "Compost solids", "Water", "Water added"]);
    expect(product.map((component) => Math.round(component.massKg ?? Number.NaN))).toEqual([600, 190, 150, 160]);
  });

  it("leaves the pooled water unknown while any water it pools is unknown", () => {
    const source = sourceComponents({ wetKg: 700, dryKg: null, addedWaterKg: 0 });
    const product = productCompositionComponents(source, ingredientComponents(ingredient));
    expect(product.find((component) => component.kind === "water")?.massKg).toBeNull();
    expect(product.find((component) => component.kind === "biochar")?.massKg).toBeNull();
  });
});
