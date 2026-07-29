import { describe, expect, it } from "vitest";
import { buildBatchSankey, type SankeyLineage } from "./sankey";

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
      { id: "fs-1", massUsedKg: 10_000, eligibilityStatus: "eligible" },
    ],
    ...overrides,
  };
}

describe("buildBatchSankey", () => {
  it("builds the four columns with labeled exits for a single lineage", () => {
    // The ineligible exit derives from the lineage's own feedstock
    // eligibility flags (issue #285) — no batch-level fact is passed in.
    const result = buildBatchSankey([
      lineage({
        feedstocks: [
          { id: "fs-1", massUsedKg: 9_000, eligibilityStatus: "eligible" },
          { id: "fs-2", massUsedKg: 1_000, eligibilityStatus: "ineligible" },
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

    // 10 000 in − 1 000 ineligible − 3 000 out = 6 000 conversion loss;
    // 3 000 lot − 2 000 applied = 1 000 in storage.
    expect(result.exits).toEqual([
      expect.objectContaining({
        key: "ineligible_feedstock",
        massKg: 1_000,
        tone: "alert",
        fromColumn: "feedstock",
      }),
      expect.objectContaining({
        key: "conversion_loss",
        massKg: 6_000,
        fromColumn: "productionRuns",
      }),
      expect.objectContaining({
        key: "in_storage",
        massKg: 1_000,
        fromColumn: "biocharLots",
      }),
    ]);
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
          massUsedKg: 10_000,
          eligibilityStatus: "eligible" as const,
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
                massUsedKg: 6_000,
                eligibilityStatus: "eligible",
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
                massUsedKg: 4_000,
                eligibilityStatus: "eligible",
              },
            ],
          },
        ],
      }),
    ]);

    expect(result.columns[0]).toMatchObject({ massKg: 10_000, count: 2 });
    expect(result.columns[1]).toMatchObject({ massKg: 3_000, count: 2 });
  });

  it("dedupes the ineligible-feedstock exit for a run shared across applications", () => {
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
          massUsedKg: 8_000,
          eligibilityStatus: "eligible" as const,
        },
        {
          id: "fs-2",
          massUsedKg: 2_000,
          eligibilityStatus: "ineligible" as const,
        },
      ],
    };
    const result = buildBatchSankey([
      lineage({ ...shared, application: { id: "app-1", biocharAppliedDryTons: 1 } }),
      lineage({ ...shared, application: { id: "app-2", biocharAppliedDryTons: 1 } }),
    ]);

    // The shared run's ineligible allocation counts once, not per application.
    expect(result.exits).toContainEqual(
      expect.objectContaining({ key: "ineligible_feedstock", massKg: 2_000 }),
    );
  });

  it("falls back to allocation records when a run has no recorded input mass", () => {
    const result = buildBatchSankey([
      lineage({
        productionRun: {
          id: "run-1",
          feedstockMassDryKg: null,
          biocharDryMassKg: 2_000,
        },
        feedstocks: [
          { id: "fs-1", massUsedKg: 4_000, eligibilityStatus: "eligible" },
          { id: "fs-2", massUsedKg: 3_000, eligibilityStatus: null },
        ],
      }),
    ]);

    expect(result.columns[0]).toMatchObject({ massKg: 7_000, count: 2 });
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
          // Ineligible allocation exceeds the run's recorded input mass.
          { id: "fs-1", massUsedKg: 2_000, eligibilityStatus: "ineligible" },
        ],
      }),
    ]);

    expect(result.exits).toContainEqual(
      expect.objectContaining({ key: "ineligible_feedstock", massKg: 1_000 }),
    );
    expect(
      result.exits.filter((e) =>
        ["conversion_loss", "unallocated_output", "in_storage"].includes(e.key),
      ),
    ).toEqual([]);
    expect(result.warnings).toHaveLength(4);
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
          { id: "fs-1", massUsedKg: 475, eligibilityStatus: "eligible" },
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
