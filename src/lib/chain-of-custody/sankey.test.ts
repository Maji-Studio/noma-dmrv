import { describe, expect, it } from "vitest";
import { kgToTonnes } from "@/lib/calculations/unit-conversions";
import { formatMassKg } from "@/lib/format-utils";
import { buildBatchSankey, EXIT_EPSILON_KG, type SankeyLineage } from "./sankey";

const RESIDUAL_TEST_INPUT_KG = 1_000;
const ROUNDING_CONVERSION_KG = 0.4;
const ROUNDING_DOWNSTREAM_KG = -0.3;
const BLEND_KG = 2_000;
const INGREDIENT_KG = 500;
const BLENDED_DRY_KG = 1_200;
const ALLOCATED_DRY_KG = 1_100;
const APPLIED_KG = 1_000;
const COMPOSITION = {
  ingredients: [{
    formulationIngredientId: "ingredient-line",
    feedstockTypeId: "blend-feedstock",
    feedstockTypeName: "Blend ingredient",
    feedstockTypeCategory: "manure",
    massKg: INGREDIENT_KG,
  }],
};

function lineage(overrides: Partial<SankeyLineage> = {}): SankeyLineage {
  return {
    application: { id: "app-1", biocharAppliedDryTons: 2 },
    productionRun: {
      id: "run-1",
      feedstockMassDryKg: 10_000,
      biocharDryMassKg: 3_000,
    },
    biocharProduct: { id: "lot-1", massKg: 3_000, moistureContentPercent: null },
    feedstocks: [
      { id: "fs-1", wetMassUsedKg: 10_000 },
    ],
    ...overrides,
  };
}

describe("buildBatchSankey", () => {
  it("closes every displayed column using the same precision as the mass labels", () => {
    // Independently rounded raw differences would read 40, 20, 20 and fail
    // to connect the displayed columns 100 -> 60.1 -> 40 -> 20.1.
    const result = buildBatchSankey([lineage({
      productionRun: { id: "run-1", feedstockMassDryKg: 100.04, biocharDryMassKg: 60.06 },
      biocharProduct: { id: "lot-1", massKg: 40.04, moistureContentPercent: null },
      application: { id: "app-1", biocharAppliedDryTons: kgToTonnes(20.06) },
    })]);

    expect(result.columns.map(({ massKg }) => formatMassKg(massKg))).toEqual([
      "100 kg", "60.1 kg", "40 kg", "20.1 kg",
    ]);
    expect(result.exits.map(({ massKg }) => formatMassKg(massKg))).toEqual([
      "39.9 kg", "20.1 kg", "19.9 kg",
    ]);
    // Compare integer tenths parsed from the actual labels, avoiding binary
    // floating-point subtraction in the displayed-figures assertion.
    const displayedTenths = (massKg: number) => Math.round(Number(formatMassKg(massKg).replace(/[^\d.-]/g, "")) * 10);
    result.exits.forEach((exit, index) => {
      expect(exit.rawKg).toBeCloseTo([39.98, 20.02, 19.98][index]);
      expect(displayedTenths(result.columns[index].massKg) - displayedTenths(exit.massKg))
        .toBe(displayedTenths(result.columns[index + 1].massKg));
    });
    expect(result.omittedResidualKg).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  it.each([
    { moisture: 20, allocated: null, expectedKg: BLENDED_DRY_KG },
    { moisture: null, allocated: null, expectedKg: BLEND_KG - INGREDIENT_KG },
    { moisture: 20, allocated: ALLOCATED_DRY_KG, expectedKg: ALLOCATED_DRY_KG },
    { moisture: null, allocated: 0, expectedKg: 0 },
  ])("counts blended biochar with moisture=$moisture and allocation=$allocated", ({ moisture, allocated, expectedKg }) => {
    const entry = lineage({
      application: { id: "app-1", biocharAppliedDryTons: kgToTonnes(APPLIED_KG) },
      biocharProduct: { id: "lot-1", massKg: BLEND_KG, moistureContentPercent: moisture, composition: COMPOSITION },
    });
    if (allocated != null) {
      entry.sources = [{ productionRun: entry.productionRun!, feedstocks: entry.feedstocks, allocatedDryMassKg: allocated }];
    }
    const result = buildBatchSankey([entry]);

    expect(result.columns.find((column) => column.key === "biocharLots")?.massKg).toBe(expectedKg);
    if (expectedKg > APPLIED_KG) {
      expect(result.exits).toContainEqual(expect.objectContaining({ key: "in_storage", massKg: expectedKg - APPLIED_KG }));
    }
  });

  it("builds the four columns with labeled exits for a single lineage", () => {
    const result = buildBatchSankey([
      lineage({
        feedstocks: [
          { id: "fs-1", wetMassUsedKg: 9_000 },
          { id: "fs-2", wetMassUsedKg: 1_000 },
        ],
      }),
    ]);

    expect(result.columns.map((c) => c.key)).toEqual([
      "feedstock",
      "productionRuns",
      "biocharLots",
      "applied",
    ]);
    expect(result.columns[0].massKg).toBe(10_000);
    expect(result.columns[1].massKg).toBe(3_000);
    expect(result.columns[2].massKg).toBe(3_000);
    expect(result.columns[3].massKg).toBe(2_000);

    // 10 000 in − 3 000 out = 7 000 conversion loss;
    // 3 000 lot − 2 000 applied = 1 000 in storage.
    expect(result.exits).toEqual([
      expect.objectContaining({
        key: "conversion_loss",
        massKg: 7_000,
        rawKg: 7_000,
        fromColumn: "productionRuns",
      }),
      expect.objectContaining({
        key: "in_storage",
        massKg: 1_000,
        rawKg: 1_000,
        fromColumn: "biocharLots",
      }),
    ]);
    expect(result.warnings).toEqual([]);
    expect(result.omittedResidualKg).toBe(0);
  });

  it("shows a 0.3 kg middle residual so displayed exits telescope", () => {
    const result = buildBatchSankey([lineage({
      productionRun: { id: "run-1", feedstockMassDryKg: 100.04, biocharDryMassKg: 60.06 },
      biocharProduct: { id: "lot-1", massKg: 59.76, moistureContentPercent: null },
      application: { id: "app-1", biocharAppliedDryTons: kgToTonnes(20.06) },
    })]);
    const displayedTenths = (kg: number) => Math.round(Number(formatMassKg(kg).replace(/[^\d.-]/g, "")) * 10);

    expect(result.exits.map(({ massKg }) => formatMassKg(massKg))).toEqual([
      "39.9 kg", "0.3 kg", "39.7 kg",
    ]);
    expect(displayedTenths(result.columns[0].massKg) - result.exits.reduce((sum, exit) => sum + displayedTenths(exit.massKg), 0))
      .toBe(displayedTenths(result.columns[3].massKg));
    expect(result.omittedResidualKg).toBe(0);
    expect(result.warnings).toEqual([]);
  });

  it.each([EXIT_EPSILON_KG / 2, EXIT_EPSILON_KG])(
    "shows positive displayed residuals even at %s kg raw",
    (residualKg) => {
      const runOutputKg = RESIDUAL_TEST_INPUT_KG - residualKg;
      const lotKg = runOutputKg - residualKg;
      const appliedKg = lotKg - residualKg;
      const result = buildBatchSankey([lineage({
        productionRun: { id: "run-1", feedstockMassDryKg: RESIDUAL_TEST_INPUT_KG, biocharDryMassKg: runOutputKg },
        biocharProduct: { id: "lot-1", massKg: lotKg, moistureContentPercent: null },
        application: { id: "app-1", biocharAppliedDryTons: kgToTonnes(appliedKg) },
      })]);

      expect(result.exits.map((exit) => exit.key)).toEqual(["conversion_loss", "unallocated_output", "in_storage"]);
      expect(result.exits.reduce((sum, exit) => sum + exit.massKg, 0)).toBeCloseTo(
        Number(formatMassKg(RESIDUAL_TEST_INPUT_KG).replace(/[^\d.-]/g, "")) - Number(formatMassKg(appliedKg).replace(/[^\d.-]/g, "")),
      );
      expect(result.omittedResidualKg).toBe(0);
      expect(result.warnings).toEqual([]);
    },
  );

  it("keeps mixed-sign omitted residuals in the closing balance", () => {
    const runOutputKg = RESIDUAL_TEST_INPUT_KG - ROUNDING_CONVERSION_KG;
    const lotKg = runOutputKg - ROUNDING_DOWNSTREAM_KG;
    const appliedKg = lotKg - ROUNDING_DOWNSTREAM_KG;
    const result = buildBatchSankey([lineage({
      productionRun: { id: "run-1", feedstockMassDryKg: RESIDUAL_TEST_INPUT_KG, biocharDryMassKg: runOutputKg },
      biocharProduct: { id: "lot-1", massKg: lotKg, moistureContentPercent: null },
      application: { id: "app-1", biocharAppliedDryTons: kgToTonnes(appliedKg) },
    })]);

    expect(result.exits).toEqual([expect.objectContaining({
      key: "conversion_loss",
      massKg: ROUNDING_CONVERSION_KG,
      rawKg: expect.closeTo(ROUNDING_CONVERSION_KG),
    })]);
    expect(result.warnings).toEqual([]);
    expect(result.omittedResidualKg).toBeCloseTo(ROUNDING_DOWNSTREAM_KG + ROUNDING_DOWNSTREAM_KG);
    expect(result.columns[0].massKg - ROUNDING_CONVERSION_KG - result.omittedResidualKg).toBeCloseTo(result.columns[3].massKg);
  });

  it("retains raw positive residuals whose displayed columns are equal", () => {
    const result = buildBatchSankey([lineage({
      productionRun: { id: "run-1", feedstockMassDryKg: 100.04, biocharDryMassKg: 100.03 },
      biocharProduct: { id: "lot-1", massKg: 100.02, moistureContentPercent: null },
      application: { id: "app-1", biocharAppliedDryTons: kgToTonnes(100.01) },
    })]);

    expect(result.exits).toEqual([]);
    expect(result.omittedResidualKg).toBeCloseTo(0.03);
    expect(result.columns.map((column) => column.massKg)).toEqual([100.04, 100.03, 100.02, 100.01]);
    expect(result.warnings).toEqual([]);
  });

  it("dedupes runs, lots, and feedstocks shared across member applications", () => {
    const shared = {
      productionRun: {
        id: "run-1",
        feedstockMassDryKg: 10_000,
        biocharDryMassKg: 3_000,
      },
      biocharProduct: { id: "lot-1", massKg: 3_000, moistureContentPercent: null },
      feedstocks: [
        {
          id: "fs-1",
          wetMassUsedKg: 10_000,
        },
      ],
    };
    const result = buildBatchSankey([
      lineage({ ...shared, application: { id: "app-1", biocharAppliedDryTons: 1 } }),
      lineage({ ...shared, application: { id: "app-2", biocharAppliedDryTons: 1.5 } }),
    ]);

    // The shared run/lot/feedstock counts once; applications still sum.
    expect(result.columns[0]).toMatchObject({ massKg: 10_000, count: 1 });
    expect(result.columns[1]).toMatchObject({ massKg: 3_000, count: 1 });
    expect(result.columns[2]).toMatchObject({ massKg: 3_000, count: 1 });
    expect(result.columns[3]).toMatchObject({ massKg: 2_500, count: 2 });
  });

  it("counts distinct applications when one application has multiple source slices", () => {
    const result = buildBatchSankey([
      lineage({
        application: {
          id: "app-1",
          biocharAppliedDryTons: 0.8,
        },
      }),
      lineage({
        application: {
          id: "app-1",
          biocharAppliedDryTons: 1.2,
        },
        productionRun: {
          id: "run-2",
          feedstockMassDryKg: 4_000,
          biocharDryMassKg: 1_200,
        },
      }),
    ]);

    expect(result.columns[3]).toMatchObject({
      massKg: 2_000,
      count: 1,
    });
  });

  it("includes every source run and its feedstocks for a commingled product", () => {
    const result = buildBatchSankey([
      lineage({
        productionRun: null,
        feedstocks: [],
        sources: [
          {
            productionRun: {
              id: "run-1",
              feedstockMassDryKg: 6_000,
              biocharDryMassKg: 1_800,
            },
            feedstocks: [
              {
                id: "fs-1",
                wetMassUsedKg: 6_000,
              },
            ],
          },
          {
            productionRun: {
              id: "run-2",
              feedstockMassDryKg: 4_000,
              biocharDryMassKg: 1_200,
            },
            feedstocks: [
              {
                id: "fs-2",
                wetMassUsedKg: 4_000,
              },
            ],
          },
        ],
      }),
    ]);

    expect(result.columns[0]).toMatchObject({ massKg: 10_000, count: 2 });
    expect(result.columns[1]).toMatchObject({ massKg: 3_000, count: 2 });
  });

  it("dedupes conversion loss for a run shared across applications", () => {
    const shared = {
      productionRun: {
        id: "run-1",
        feedstockMassDryKg: 10_000,
        biocharDryMassKg: 3_000,
      },
      biocharProduct: { id: "lot-1", massKg: 3_000, moistureContentPercent: null },
      feedstocks: [
        {
          id: "fs-1",
          wetMassUsedKg: 8_000,
        },
        {
          id: "fs-2",
          wetMassUsedKg: 2_000,
        },
      ],
    };
    const result = buildBatchSankey([
      lineage({ ...shared, application: { id: "app-1", biocharAppliedDryTons: 1 } }),
      lineage({ ...shared, application: { id: "app-2", biocharAppliedDryTons: 1 } }),
    ]);

    // The shared run's conversion loss counts once, not per application.
    expect(result.exits).toContainEqual(
      expect.objectContaining({ key: "conversion_loss", massKg: 7_000 }),
    );
  });

  it("never substitutes wet allocations for missing run dry mass", () => {
    const result = buildBatchSankey([
      lineage({
        productionRun: {
          id: "run-1",
          feedstockMassDryKg: null,
          biocharDryMassKg: 2_000,
        },
        feedstocks: [
          { id: "fs-1", wetMassUsedKg: 4_000 },
          { id: "fs-2", wetMassUsedKg: 3_000 },
        ],
      }),
    ]);

    expect(result.columns[0]).toMatchObject({ massKg: 0, count: 2 });
  });

  it("uses run-derived dry mass while retaining a distinct wet allocation", () => {
    const result = buildBatchSankey([
      lineage({
        productionRun: {
          id: "run-1",
          feedstockMassDryKg: 2_400,
          biocharDryMassKg: 800,
        },
        feedstocks: [
          {
            id: "fs-1",
            wetMassUsedKg: 3_000,
          },
        ],
      }),
    ]);

    expect(result.columns[0]).toMatchObject({ massKg: 2_400, count: 1 });
  });

  it("emits an unallocated-output exit when run output never reaches a lot", () => {
    const result = buildBatchSankey([
      lineage({
        biocharProduct: {
          id: "lot-1",
          massKg: 2_200,
          moistureContentPercent: null,
        },
      }),
    ]);

    expect(result.exits).toContainEqual(
      expect.objectContaining({ key: "unallocated_output", massKg: 800 }),
    );
  });

  it("clamps inconsistent residuals to zero and warns instead of hiding them", () => {
    const result = buildBatchSankey([
      lineage({
        application: { id: "app-1", biocharAppliedDryTons: 5 }, // > lot mass
        productionRun: {
          id: "run-1",
          feedstockMassDryKg: 1_000,
          biocharDryMassKg: 3_000, // > input
        },
        biocharProduct: {
          id: "lot-1",
          massKg: 4_000,
          moistureContentPercent: null,
        }, // > run output
        feedstocks: [
          { id: "fs-1", wetMassUsedKg: 2_000 },
        ],
      }),
    ]);

    expect(result.exits.map(exit => exit.key)).not.toContain("ineligible_feedstock");
    expect(
      result.exits.filter((e) =>
        ["conversion_loss", "unallocated_output", "in_storage"].includes(e.key),
      ),
    ).toEqual([]);
    expect(result.warnings).toHaveLength(3);
    expect(result.omittedResidualKg).toBe(0);
  });

  it("converts a moist lot to a dry basis so it balances against runs (F14)", () => {
    // Runs output 475 kg dry; the lot's WET mass is 500 kg at 5% moisture, so
    // its dry mass is 475 kg. Without the conversion the lots column (500)
    // would falsely exceed run output (475) and raise a mass-balance warning.
    const result = buildBatchSankey([
      lineage({
        application: { id: "app-1", biocharAppliedDryTons: 0.38 },
        productionRun: {
          id: "run-1",
          feedstockMassDryKg: 475,
          biocharDryMassKg: 475,
        },
        biocharProduct: { id: "lot-1", massKg: 500, moistureContentPercent: 5 },
        feedstocks: [
          { id: "fs-1", wetMassUsedKg: 475 },
        ],
      }),
    ]);

    // Lots column reports dry mass (475), not the wet 500.
    expect(result.columns[2].massKg).toBe(475);
    expect(result.warnings).toEqual([]);
    // In-storage exit uses the dry figure: 475 dry − 380 applied = 95.
    expect(result.exits).toContainEqual(
      expect.objectContaining({ key: "in_storage", massKg: 95 }),
    );
    expect(result.exits.map((e) => e.key)).not.toContain("unallocated_output");
  });

  it("handles lineages that stop at product level (no production run)", () => {
    const result = buildBatchSankey([
      lineage({
        productionRun: null,
        feedstocks: [],
      }),
    ]);

    expect(result.columns[0]).toMatchObject({ massKg: 0, count: 0 });
    expect(result.columns[1]).toMatchObject({ massKg: 0, count: 0 });
    expect(result.columns[2]).toMatchObject({ massKg: 3_000, count: 1 });
    expect(result.columns[3]).toMatchObject({ massKg: 2_000, count: 1 });
  });
});
