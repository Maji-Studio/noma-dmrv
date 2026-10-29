import { describe, expect, it } from "vitest";
import { buildBatchSankey, type SankeyLineage } from "@/lib/chain-of-custody/sankey";
import { buildWaterfall, chartMaxKg, DEFAULT_COLUMN, levelAfter, type WaterfallLineage } from "./waterfall-model";

const RUN_DRY_IN_KG = 4_000;
const RUN_DRY_OUT_KG = 1_500;
const APPLIED_DRY_T = 1;
const APPLIED_WET_T = 1.2;

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
    expect(model.items[0].records.every((record) => record.massKg == null)).toBe(true);
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
    expect(byKey("feedstock")?.records.map((record) => [record.code, record.massKg])).toEqual([
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
    expect(model.items.map((item) => item.key)).not.toContain("water_driven_off");
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
    expect(model.warnings.some((warning) => warning.startsWith("PR-A:"))).toBe(true);
    expect(model.warnings.some((warning) => warning.startsWith("PR-B:"))).toBe(false);
  });

  it("sizes the plot to the highest column even when applied exceeds the input", () => {
    const lineages = [lineage([null], { id: "app-1", code: "AP-26-001", dryT: 0.25, wetT: 0.3 })];
    (lineages[0].productionRun as { feedstockMassDryKg: number | null }).feedstockMassDryKg = null;
    const model = buildWaterfall(buildBatchSankey(lineages), lineages);

    expect(model.startKg).toBe(0);
    expect(model.endKg).toBe(250);
    expect(chartMaxKg(model)).toBeGreaterThanOrEqual(model.endKg);
  });
});
