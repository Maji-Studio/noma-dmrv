import { describe, expect, it } from "vitest";
import { formatMassKg } from "@/lib/format-utils";
import { buildBatchSankey, EXIT_EPSILON_KG, type SankeyLineage } from "@/lib/chain-of-custody/sankey";
import { kgToTonnes, tonnesToKg } from "@/lib/calculations/unit-conversions";
import { signedKg, summarySentence, valueLabel } from "./waterfall-parts";
import { buildWaterfall, chartMaxKg, DEFAULT_COLUMN, levelAfter, type WaterfallLineage } from "./waterfall-model";

const RUN_DRY_IN_KG = 4_000;
const RUN_DRY_OUT_KG = 1_500;
const APPLIED_DRY_T = 1;
const APPLIED_WET_T = 1.2;
const ROUNDING_CONVERSION_KG = 0.4;
const ROUNDING_DOWNSTREAM_KG = -0.3;
const BLEND_KG = 2_000;
const INGREDIENT_KG = 500;
const BLENDED_DRY_KG = 1_200;
const ALLOCATED_DRY_KG = 1_100;
const COMPOSITION = {
  ingredients: [{
    formulationIngredientId: "ingredient-line",
    feedstockTypeId: "blend-feedstock",
    feedstockTypeName: "Blend ingredient",
    feedstockTypeCategory: "manure",
    massKg: INGREDIENT_KG,
  }],
};

function lineage(
  wetKg: (number | null)[],
  application: { id: string; code: string; dryT: number; wetT: number },
): WaterfallLineage & SankeyLineage {
  return {
    application: {
      id: application.id,
      code: application.code,
      fieldIdentifier: "North field",
      biocharAppliedDryTons: application.dryT,
      biocharAppliedTons: application.wetT,
    },
    productionRun: {
      id: "run-1",
      code: "PR-26-001",
      feedstockMassDryKg: RUN_DRY_IN_KG,
      biocharDryMassKg: RUN_DRY_OUT_KG,
    },
    biocharProduct: {
      id: "lot-1",
      code: "BP-26-001",
      formulationName: "Pure biochar",
      massKg: RUN_DRY_OUT_KG,
      moistureContentPercent: null,
    },
    feedstocks: wetKg.map((mass, index) => ({
      id: `fs-${index + 1}`,
      code: `FS-26-00${index + 1}`,
      feedstockTypeName: "Wood chips",
      wetMassUsedKg: mass,
    })),
  } as unknown as WaterfallLineage & SankeyLineage;
}

function build(wetKg: (number | null)[]) {
  const lineages = [lineage(wetKg, { id: "app-1", code: "AP-26-001", dryT: APPLIED_DRY_T, wetT: APPLIED_WET_T })];
  return buildWaterfall(buildBatchSankey(lineages), lineages);
}

describe("buildWaterfall", () => {
  it("closes a wet start on Applied using the displayed fractional masses", () => {
    const entry = lineage([120.04], {
      id: "app-1", code: "AP-26-001", dryT: kgToTonnes(20.04), wetT: kgToTonnes(25.06),
    });
    entry.productionRun = { ...entry.productionRun!, feedstockMassDryKg: 100.06, biocharDryMassKg: 60.04 };
    entry.biocharProduct = { ...entry.biocharProduct!, massKg: 40.06 };
    entry.sources = [{
      productionRun: entry.productionRun!, reactor: null, feedstocks: entry.feedstocks,
      allocatedWetMassKg: 40.06, allocatedDryMassKg: 40.06,
    }];
    const model = buildWaterfall(buildBatchSankey([entry]), [entry]);
    const displayedTenths = (kg: number) => Math.round(Number(formatMassKg(kg).replace(/[^\d.-]/g, "")) * 10);
    const steps = model.items.filter((item) => item.kind === "step");

    expect(model.startBasis).toBe("wet");
    expect(steps.map((item) => formatMassKg(item.massKg))).toEqual([
      "19.9 kg", "40.1 kg", "19.9 kg", "20.1 kg",
    ]);
    expect(displayedTenths(model.startKg) - steps.reduce((sum, item) => sum + displayedTenths(item.massKg), 0))
      .toBe(displayedTenths(model.endKg));
    expect(model.balanced).toBe(true);
    for (const step of steps) {
      expect(step.records).toHaveLength(1);
      expect(formatMassKg(step.records[0].massKg)).toBe(formatMassKg(step.massKg));
    }
  });

  it.each([
    { moisture: 20, allocated: null, expectedKg: BLENDED_DRY_KG },
    { moisture: null, allocated: null, expectedKg: BLEND_KG - INGREDIENT_KG },
    { moisture: 20, allocated: ALLOCATED_DRY_KG, expectedKg: ALLOCATED_DRY_KG },
  ])("matches blended-lot totals and records with moisture=$moisture and allocation=$allocated", ({ moisture, allocated, expectedKg }) => {
    const entry = lineage([RUN_DRY_IN_KG], { id: "app-1", code: "AP-26-001", dryT: APPLIED_DRY_T, wetT: APPLIED_WET_T });
    entry.biocharProduct = { ...entry.biocharProduct!, massKg: BLEND_KG, moistureContentPercent: moisture, composition: COMPOSITION };
    if (allocated != null) {
      entry.sources = [{
        productionRun: entry.productionRun!, reactor: null, feedstocks: entry.feedstocks,
        allocatedWetMassKg: BLEND_KG - INGREDIENT_KG, allocatedDryMassKg: allocated,
      }];
    }
    const model = buildWaterfall(buildBatchSankey([entry]), [entry]);
    const storedKg = expectedKg - tonnesToKg(APPLIED_DRY_T);
    const storage = model.items.find((item) => item.key === "in_storage");

    expect(storage?.massKg).toBe(storedKg);
    expect(storage?.records[0].massKg).toBe(storedKg);
    expect(model.balanced).toBe(true);
    expect(model.warnings).toEqual([]);
  });

  it("starts wet, steps down by every exit the lib computes and ends on applied", () => {
    const model = build([3_000, 2_000]);

    expect(model.startBasis).toBe("wet");
    expect(model.items.map((item) => [item.key, item.massKg])).toEqual([
      ["feedstock", 5_000],
      ["water_driven_off", 1_000],
      ["conversion_loss", 2_500],
      ["in_storage", 500],
      ["applied", 1_000],
    ]);
    expect(model.items.map((item) => item.kind)).toEqual(["start", "step", "step", "step", "end"]);
    expect(model.removedKg).toBe(4_000);
    expect(model.stepCount).toBe(3);
  });

  it("carries the level down so the last step lands on the lit column", () => {
    const model = build([3_000, 2_000]);
    const steps = model.items.filter((item) => item.kind === "step");

    expect(levelAfter(steps[steps.length - 1])).toBe(model.endKg);
    expect(model.appliedWetKg).toBe(1_200);
  });

  it("falls back to the dry feedstock when a draw has no wet mass", () => {
    const model = build([3_000, null]);

    expect(model.startBasis).toBe("dry");
    expect(model.items.map((item) => item.key)).toEqual(["feedstock", "conversion_loss", "in_storage", "applied"]);
    expect(model.startKg).toBe(RUN_DRY_IN_KG);
    expect(model.dryStartReason).toBe("wet-missing");
    expect(model.items[0].figureMissing).toBe(false);
    // The wet draw that is recorded stays on its record; only the null one is missing.
    expect(model.items[0].records.map((record) => record.wetKg)).toEqual([3_000, null]);
  });

  it("groups the steps under the stage they leave from", () => {
    const model = build([3_000, 2_000]);

    expect(model.groups.map((group) => [group.stage, group.keys])).toEqual([
      ["productionRuns", ["water_driven_off", "conversion_loss"]],
      ["biocharLots", ["in_storage"]],
    ]);
  });

  it("lists the records behind each column and defaults to the lit one", () => {
    const model = build([3_000, 2_000]);
    const byKey = (key: string) => model.items.find((item) => item.key === key);

    expect(DEFAULT_COLUMN).toBe("applied");
    expect(model.items[model.items.length - 1].key).toBe(DEFAULT_COLUMN);
    expect(byKey("feedstock")?.records.map((record) => [record.code, record.wetKg])).toEqual([
      ["FS-26-001", 3_000],
      ["FS-26-002", 2_000],
    ]);
    expect(byKey("water_driven_off")?.records).toEqual([
      expect.objectContaining({ kind: "productionRun", code: "PR-26-001", massKg: 1_000 }),
    ]);
    expect(byKey("conversion_loss")?.records[0]).toMatchObject({ code: "PR-26-001", massKg: 2_500 });
    expect(byKey("in_storage")?.records[0]).toMatchObject({ kind: "biocharProduct", code: "BP-26-001", massKg: 500 });
    expect(byKey("applied")?.records).toEqual([
      expect.objectContaining({ kind: "application", code: "AP-26-001", massKg: 1_000, wetKg: 1_200 }),
    ]);
  });

  it("sums an application that arrives once per product slice", () => {
    const slices = [
      lineage([3_000, 2_000], { id: "app-1", code: "AP-26-001", dryT: 0.4, wetT: 0.5 }),
      lineage([3_000, 2_000], { id: "app-1", code: "AP-26-001", dryT: 0.6, wetT: 0.7 }),
    ];
    const model = buildWaterfall(buildBatchSankey(slices), slices);
    const applied = model.items[model.items.length - 1];

    expect(applied.records).toHaveLength(1);
    expect(applied.records[0].massKg).toBeCloseTo(1_000);
    expect(applied.records[0].wetKg).toBeCloseTo(1_200);
  });

  it("does not invent water when a run has no recorded dry input", () => {
    const lineages = [lineage([2_000], { id: "app-1", code: "AP-26-001", dryT: 0.25, wetT: 0.3 })];
    (lineages[0].productionRun as { feedstockMassDryKg: number | null }).feedstockMassDryKg = null;
    const model = buildWaterfall(buildBatchSankey(lineages), lineages);

    expect(model.startBasis).toBe("dry");
    expect(model.dryStartReason).toBe("dry-input-missing");
    // No partial figure stated as fact: the sentence and the start column name the gap.
    expect(summarySentence(model)).toBe("Dry feedstock is not recorded on every run.");
    expect(valueLabel(model.items[0])).toBe(formatMassKg(null));
    expect(signedKg(model.items[0])).toBe(formatMassKg(null));
    expect(model.items.map((item) => item.key)).not.toContain("water_driven_off");
  });

  it("starts wet with no water step when the wet and dry feedstock match", () => {
    const model = build([RUN_DRY_IN_KG]);

    expect(model.startBasis).toBe("wet");
    expect(model.dryStartReason).toBeNull();
    expect(model.items[0].figureMissing).toBe(false);
    expect(model.startKg).toBe(RUN_DRY_IN_KG);
    expect(model.items.map((item) => item.key)).not.toContain("water_driven_off");
  });

  it("prioritises missing dry input when a wet draw is also missing", () => {
    const known = lineage([null], { id: "app-1", code: "AP-26-001", dryT: APPLIED_DRY_T, wetT: APPLIED_WET_T });
    const missing = lineage([2_000], { id: "app-2", code: "AP-26-002", dryT: APPLIED_DRY_T, wetT: APPLIED_WET_T });
    missing.productionRun = { ...missing.productionRun!, id: "run-2", feedstockMassDryKg: null };
    const lineages = [known, missing];
    const model = buildWaterfall(buildBatchSankey(lineages), lineages);

    expect(model.startKg).toBe(RUN_DRY_IN_KG);
    expect(model.startBasis).toBe("dry");
    expect(model.dryStartReason).toBe("dry-input-missing");
    expect(model.items[0].figureMissing).toBe(true);
    expect(signedKg(model.items[0])).toBe(formatMassKg(null));
    expect(valueLabel(model.items[0])).toBe(formatMassKg(null));
    expect(summarySentence(model)).toBe("Dry feedstock is not recorded on every run.");
  });

  it("keeps the wet-below-dry reason when every dry input is known", () => {
    const model = build([RUN_DRY_IN_KG - RUN_DRY_OUT_KG]);

    expect(model.dryStartReason).toBe("wet-below-dry");
    expect(model.items[0].figureMissing).toBe(false);
    expect(summarySentence(model)).toContain(`${formatMassKg(RUN_DRY_IN_KG)} of dry feedstock went in.`);
  });

  it.each([
    { residualKg: EXIT_EPSILON_KG / 2, removedKg: 0.7 },
    { residualKg: EXIT_EPSILON_KG, removedKg: 1.5 },
  ])(
    "balances displayed dry residuals of $residualKg kg alongside omitted water",
    ({ residualKg, removedKg }) => {
      const runOutputKg = RUN_DRY_IN_KG - residualKg;
      const lotKg = runOutputKg - residualKg;
      const entry = lineage([RUN_DRY_IN_KG + residualKg], {
        id: "app-1", code: "AP-26-001", dryT: kgToTonnes(lotKg - residualKg), wetT: APPLIED_WET_T,
      });
      entry.productionRun = { ...entry.productionRun!, biocharDryMassKg: runOutputKg };
      entry.biocharProduct = { ...entry.biocharProduct!, massKg: lotKg };
      const lineages = [entry];
      const model = buildWaterfall(buildBatchSankey(lineages), lineages);

      expect(model.startKg - model.endKg).toBeGreaterThan(EXIT_EPSILON_KG);
      expect(model.items.map((item) => item.key)).toEqual([
        "feedstock", "conversion_loss", "unallocated_output", "in_storage", "applied",
      ]);
      expect(model.stepCount).toBe(3);
      expect(model.removedKg).toBeCloseTo(removedKg);
      expect(model.warnings).toEqual([]);
      expect(model.balanced).toBe(true);
    },
  );

  it.each([0, -EXIT_EPSILON_KG])("balances mixed-sign omitted residuals with %s kg of hidden water", (waterKg) => {
    const runOutputKg = RUN_DRY_IN_KG - ROUNDING_CONVERSION_KG;
    const lotKg = runOutputKg - ROUNDING_DOWNSTREAM_KG;
    const entry = lineage([RUN_DRY_IN_KG + waterKg], {
      id: "app-1", code: "AP-26-001", dryT: kgToTonnes(lotKg - ROUNDING_DOWNSTREAM_KG), wetT: APPLIED_WET_T,
    });
    entry.productionRun = { ...entry.productionRun!, biocharDryMassKg: runOutputKg };
    entry.biocharProduct = { ...entry.biocharProduct!, massKg: lotKg };
    const lineages = [entry];
    const model = buildWaterfall(buildBatchSankey(lineages), lineages);

    expect(model.startBasis).toBe("wet");
    expect(model.items.map((item) => item.key)).toEqual(["feedstock", "conversion_loss", "applied"]);
    expect(model.warnings).toEqual([]);
    expect(model.balanced).toBe(true);
  });

  it("does not hide a genuine imbalance alongside omitted residuals", () => {
    const residualKg = EXIT_EPSILON_KG / 2;
    const lotKg = RUN_DRY_IN_KG + RUN_DRY_OUT_KG;
    const entry = lineage([RUN_DRY_IN_KG + residualKg], {
      id: "app-1", code: "AP-26-001", dryT: kgToTonnes(lotKg - residualKg), wetT: APPLIED_WET_T,
    });
    entry.productionRun = { ...entry.productionRun!, biocharDryMassKg: RUN_DRY_IN_KG - residualKg };
    entry.biocharProduct = { ...entry.biocharProduct!, massKg: lotKg };
    const lineages = [entry];
    const model = buildWaterfall(buildBatchSankey(lineages), lineages);

    expect(model.items.map((item) => item.key)).toEqual(["feedstock", "conversion_loss", "in_storage", "applied"]);
    expect(model.warnings).not.toEqual([]);
    expect(model.balanced).toBe(false);
  });

  it("includes omitted water alongside a displayed dry residual", () => {
    const residualKg = EXIT_EPSILON_KG * 0.75;
    const entry = lineage([RUN_DRY_IN_KG + residualKg], {
      id: "app-1", code: "AP-26-001", dryT: kgToTonnes(RUN_DRY_OUT_KG - residualKg), wetT: APPLIED_WET_T,
    });
    const lineages = [entry];
    const model = buildWaterfall(buildBatchSankey(lineages), lineages);

    expect(model.items.map((item) => item.key)).toEqual(["feedstock", "conversion_loss", "in_storage", "applied"]);
    expect(model.startKg - model.removedKg - model.endKg).toBeCloseTo(0.35);
    expect(model.balanced).toBe(true);
  });

  it("says a figure cannot be derived instead of calling it unrecorded", () => {
    const lineages = [lineage([3_000, 2_000], { id: "app-1", code: "AP-26-001", dryT: 1, wetT: 1.2 })];
    (lineages[0].productionRun as { biocharDryMassKg: number | null }).biocharDryMassKg = null;
    const model = buildWaterfall(buildBatchSankey(lineages), lineages);
    const row = model.items.flatMap((item) => item.records).find((record) => record.kind === "productionRun" && record.massKg == null);

    expect(row?.note).toBeTruthy();
  });

  it("keeps each run's signed residual and warns about the one that is negative", () => {
    const run = (id: string, code: string, dryOut: number) => ({
      productionRun: { id, code, feedstockMassDryKg: 1_000, biocharDryMassKg: dryOut },
      feedstocks: [{ id: `fs-${id}`, code: `FS-${id}`, feedstockTypeName: "Wood", wetMassUsedKg: 1_000 }],
      allocatedDryMassKg: null,
    });
    const lineages = [
      {
        application: { id: "app-1", code: "AP-26-001", fieldIdentifier: null, biocharAppliedDryTons: 0.5, biocharAppliedTons: null },
        productionRun: null,
        biocharProduct: { id: "lot-1", code: "BP-26-001", formulationName: null, massKg: 1_400, moistureContentPercent: null },
        feedstocks: [],
        sources: [run("run-a", "PR-A", 1_100), run("run-b", "PR-B", 300)],
      },
    ] as unknown as (WaterfallLineage & SankeyLineage)[];
    const model = buildWaterfall(buildBatchSankey(lineages), lineages);
    const loss = model.items.find((item) => item.key === "conversion_loss");

    expect(loss?.massKg).toBe(600);
    expect(loss?.records.map((record) => [record.code, record.massKg])).toEqual([
      ["PR-A", -100],
      ["PR-B", 700],
    ]);
    expect(loss?.records[0].note).toBeTruthy();
    expect(model.warnings.some((warning) => warning.startsWith("PR-A "))).toBe(true);
    expect(model.warnings.some((warning) => warning.startsWith("PR-B "))).toBe(false);
  });

  it("is balanced when the steps land on the applied column", () => {
    expect(build([3_000, 2_000]).balanced).toBe(true);
  });

  it("sizes the plot to the highest column even when applied exceeds the input", () => {
    const lineages = [lineage([null], { id: "app-1", code: "AP-26-001", dryT: 0.25, wetT: 0.3 })];
    (lineages[0].productionRun as { feedstockMassDryKg: number | null }).feedstockMassDryKg = null;
    const model = buildWaterfall(buildBatchSankey(lineages), lineages);

    expect(model.startKg).toBe(0);
    expect(model.endKg).toBe(250);
    // The steps cannot close on applied: each stands on the baseline, no floating level.
    expect(model.balanced).toBe(false);
    for (const item of model.items.filter((entry) => entry.kind === "step")) {
      expect(item.bottom).toBe(0);
      expect(item.top).toBe(item.massKg);
    }
    expect(chartMaxKg(model)).toBeGreaterThanOrEqual(model.endKg);
  });
});
