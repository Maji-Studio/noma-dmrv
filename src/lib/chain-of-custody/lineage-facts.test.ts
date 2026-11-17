import { describe, expect, it } from "vitest";
import { PERCENT_SCALE } from "@/lib/mass-moisture";
import { kgToTonnes } from "@/lib/calculations/unit-conversions";
import { extractLineageFacts } from "./lineage-facts";
import { massTotalsLineage } from "./lineage-mass-totals-test-fixtures";
import { resolveChainSources } from "./sources";

const SLICE_WET_KG = 120;
const SLICE_DRY_KG = 90;
const SECOND_SLICE_DRY_KG = 60;
const SECOND_SLICE_WET_KG = 80;
const RUN_DRY_IN_KG = 2_000;
const RUN_DRY_OUT_KG = 900;
const FEEDSTOCK_WET_KG = 3_000;
const PRODUCT_WET_KG = 850;
const MOISTURE_PERCENT = 20;
const INGREDIENT_KG = 100;
const PRODUCT_DRY_KG = 600;
const FRACTIONAL_KG = 0.04;

function slice() {
  return massTotalsLineage(SLICE_WET_KG, SLICE_DRY_KG);
}

describe("extractLineageFacts", () => {
  it("resolves explicit sources per record instead of the legacy run", () => {
    const entry = slice();
    entry.productionRun = { ...entry.productionRun!, id: "unused-run" };
    entry.feedstocks = [];
    const facts = extractLineageFacts([entry]);

    expect(facts.sources).toEqual([resolveChainSources(entry)]);
    expect(facts.sources[0]).toBe(entry.sources);
    expect(facts.runs).toEqual([{
      id: "run-1", code: "PR-1", dryInKg: RUN_DRY_IN_KG, dryOutKg: RUN_DRY_OUT_KG,
      wetInKg: FEEDSTOCK_WET_KG, allocatedKg: SLICE_DRY_KG,
    }]);
    expect(facts.feedstockCount).toBe(1);
    expect(facts.feedstockInKg).toBe(RUN_DRY_IN_KG);
    expect(facts.runOutputKg).toBe(RUN_DRY_OUT_KG);
    expect(facts.products[0]).toMatchObject({ allocatedKg: SLICE_DRY_KG, massKg: SLICE_DRY_KG, storedKg: SLICE_DRY_KG });
  });

  it.each([{ sources: undefined }, { sources: [] }])("keeps legacy source mass behavior with sources=$sources", ({ sources }) => {
    const entry = slice();
    entry.sources = sources;
    const facts = extractLineageFacts([entry]);

    expect(facts.sources).toEqual([resolveChainSources(entry)]);
    expect(facts.sources[0]).toEqual([{
      productionRun: entry.productionRun, feedstocks: entry.feedstocks,
      reactor: null, allocatedWetMassKg: null, allocatedDryMassKg: null,
    }]);
    expect(facts.runs[0].allocatedKg).toBeNull();
    // Empty explicit sources historically mean a known zero product allocation,
    // even though run resolution still falls back to the legacy run.
    expect(facts.products[0].allocatedKg).toBe(sources ? 0 : null);
    expect(facts.lotMassKg).toBe(sources ? 0 : PRODUCT_WET_KG * (1 - entry.biocharProduct!.moistureContentPercent! / PERCENT_SCALE));
  });

  it("has no resolved sources without a run and handles an empty batch", () => {
    const entry = slice();
    entry.sources = [];
    entry.productionRun = null;
    expect(extractLineageFacts([entry]).sources).toEqual([[]]);
    expect(extractLineageFacts([])).toMatchObject({
      sources: [], runs: [], feedstocks: [], products: [], applications: [],
      feedstockCount: 0, hasProductAllocations: false,
      feedstockInKg: 0, runOutputKg: 0, lotMassKg: 0, appliedKg: 0,
    });
  });

  it("sums all source allocations before resolving a commingled product", () => {
    const entry = slice();
    const second = massTotalsLineage(SECOND_SLICE_WET_KG, SECOND_SLICE_DRY_KG);
    second.sources![0].productionRun.id = "run-2";
    entry.sources!.push(second.sources![0]);
    const facts = extractLineageFacts([entry]);

    expect(facts.sources[0]).toHaveLength(2);
    expect(facts.runs.map((run) => run.id)).toEqual(["run-1", "run-2"]);
    expect(facts.products[0]).toMatchObject({
      allocatedKg: SLICE_DRY_KG + SECOND_SLICE_DRY_KG,
      massKg: SLICE_DRY_KG + SECOND_SLICE_DRY_KG,
    });
  });

  it("accumulates product allocations and application slices while deduping draws", () => {
    const first = slice();
    const second = massTotalsLineage(SECOND_SLICE_WET_KG, SECOND_SLICE_DRY_KG);
    const facts = extractLineageFacts([first, second]);
    const dryKg = SLICE_DRY_KG + SECOND_SLICE_DRY_KG;

    expect(facts.products).toHaveLength(1);
    expect(facts.products[0]).toMatchObject({ allocatedKg: dryKg, appliedKg: dryKg, storedKg: dryKg, massKg: dryKg });
    expect(facts.applications).toEqual([{
      id: "application-1", code: "AP-1", name: null,
      massKg: dryKg, wetKg: SLICE_WET_KG + SECOND_SLICE_WET_KG,
    }]);
    expect(facts.runs).toHaveLength(1);
    expect(facts.runs[0]).toMatchObject({ allocatedKg: dryKg, wetInKg: FEEDSTOCK_WET_KG });
    expect(facts.feedstocks[0].wetKg).toBe(FEEDSTOCK_WET_KG);
    expect(facts.appliedKg).toBe(dryKg);
    expect(facts.feedstockInKg).toBe(RUN_DRY_IN_KG);
  });

  it("accumulates one application across products and shared feedstock across runs", () => {
    const first = slice();
    const second = slice();
    second.biocharProduct!.id = "product-2";
    second.sources![0].productionRun.id = "run-2";
    const facts = extractLineageFacts([first, second]);

    expect(facts.products.map((product) => product.allocatedKg)).toEqual([SLICE_DRY_KG, SLICE_DRY_KG]);
    expect(facts.applications).toHaveLength(1);
    expect(facts.applications[0].massKg).toBe(SLICE_DRY_KG + SLICE_DRY_KG);
    expect(facts.feedstocks).toHaveLength(1);
    expect(facts.feedstocks[0].wetKg).toBe(FEEDSTOCK_WET_KG + FEEDSTOCK_WET_KG);
    expect(facts.feedstockCount).toBe(1);
  });

  it.each([null, undefined])("preserves unknown record masses for %s contributions", (missing) => {
    const first = slice();
    const second = slice();
    Object.assign(second.application, { biocharAppliedDryTons: missing, biocharAppliedTons: missing });
    Object.assign(second.sources![0], { allocatedDryMassKg: missing });
    Object.assign(first.sources![0].feedstocks[0], { wetMassUsedKg: missing });
    const facts = extractLineageFacts([first, second]);

    expect(facts.appliedKg).toBe(SLICE_DRY_KG);
    expect(facts.applications[0]).toMatchObject({ massKg: null, wetKg: null });
    expect(facts.runs[0]).toMatchObject({ wetInKg: null, allocatedKg: null });
    expect(facts.feedstocks[0].wetKg).toBeNull();
    // An incomplete allocation slice does not erase a previously known slice.
    expect(facts.products[0]).toMatchObject({ appliedKg: SLICE_DRY_KG, allocatedKg: SLICE_DRY_KG });
  });

  it.each([null, undefined])("keeps missing product and run masses distinct from aggregate zero for %s", (missing) => {
    const entry = slice();
    Object.assign(entry.sources![0].productionRun, { feedstockMassDryKg: missing, biocharDryMassKg: missing });
    entry.sources![0].allocatedDryMassKg = null;
    Object.assign(entry.biocharProduct!, { massKg: missing });
    const facts = extractLineageFacts([entry]);

    expect(facts.feedstockInKg).toBe(0);
    expect(facts.runOutputKg).toBe(0);
    expect(facts.runs[0].dryInKg).toBe(missing);
    expect(facts.products[0]).toMatchObject({ allocatedKg: null, massKg: 0, storedKg: null });
  });

  it.each([
    { moisture: MOISTURE_PERCENT, expectedKg: PRODUCT_DRY_KG },
    { moisture: null, expectedKg: PRODUCT_WET_KG - INGREDIENT_KG },
  ])("resolves ingredient-excluded product mass with moisture=$moisture", ({ moisture, expectedKg }) => {
    const entry = slice();
    entry.sources = undefined;
    entry.biocharProduct = {
      ...entry.biocharProduct!,
      moistureContentPercent: moisture,
      composition: { ingredients: [{
        formulationIngredientId: "ingredient-1", feedstockTypeId: "ingredient-feedstock",
        feedstockTypeName: "Blend ingredient", feedstockTypeCategory: "manure", massKg: INGREDIENT_KG,
      }] },
    };
    const facts = extractLineageFacts([entry]);

    expect(facts.products[0]).toMatchObject({ massKg: expectedKg, storedKg: expectedKg });
    expect(facts.lotMassKg).toBe(expectedKg);
  });

  it("keeps raw fractional masses without display rounding", () => {
    const entry = slice();
    const rawKg = SLICE_DRY_KG + FRACTIONAL_KG;
    entry.application.biocharAppliedDryTons = kgToTonnes(rawKg);
    entry.sources![0].allocatedDryMassKg = rawKg;
    const facts = extractLineageFacts([entry]);

    expect(facts.appliedKg).toBe(rawKg);
    expect(facts.lotMassKg).toBe(rawKg);
    expect(facts.products[0].allocatedKg).toBe(rawKg);
  });

  it("retains first-record rows and last-record column masses in insertion order", () => {
    const first = slice();
    first.sources = undefined;
    const second = slice();
    second.sources = undefined;
    second.productionRun!.feedstockMassDryKg = RUN_DRY_IN_KG + SLICE_DRY_KG;
    second.biocharProduct!.massKg = PRODUCT_WET_KG + SLICE_WET_KG;
    second.feedstocks = [{ ...second.feedstocks[0], id: "later-feedstock" }];
    const facts = extractLineageFacts([first, second]);

    expect(facts.runs[0].dryInKg).toBe(RUN_DRY_IN_KG);
    expect(facts.feedstockInKg).toBe(RUN_DRY_IN_KG + SLICE_DRY_KG);
    expect(facts.feedstocks.map((record) => record.id)).toEqual(["feedstock-1"]);
    expect(facts.feedstockCount).toBe(2);
    expect(facts.products[0].massKg).toBeGreaterThan(facts.products[0].storedKg!);
  });
});
