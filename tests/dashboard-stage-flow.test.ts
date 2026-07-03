/**
 * buildStageFlow — the dashboard custody-ribbon aggregation (Phase 5).
 * Same mass-balance grammar as buildBatchSankey: explicit labeled exits,
 * negative residuals clamped to zero with a warning.
 */
import { describe, expect, it } from "vitest";
import { buildStageFlow } from "@/lib/chain-of-custody/sankey";

const COUNTS = {
  feedstocks: 4,
  productionRuns: 2,
  biocharLots: 3,
  applications: 2,
};

describe("buildStageFlow", () => {
  it("derives conversion loss, unbagged output, and in-storage exits", () => {
    const flow = buildStageFlow({
      feedstockInKg: 18_600,
      runOutputKg: 5_300,
      lotMassKg: 5_000,
      appliedKg: 4_200,
      counts: COUNTS,
    });

    expect(flow.columns.map((c) => c.key)).toEqual([
      "feedstock",
      "productionRuns",
      "biocharLots",
      "applied",
    ]);
    expect(flow.columns[0].massKg).toBe(18_600);
    expect(flow.columns[0].count).toBe(4);

    const exitByKey = Object.fromEntries(flow.exits.map((e) => [e.key, e]));
    expect(exitByKey.conversion_loss.massKg).toBeCloseTo(13_300);
    expect(exitByKey.conversion_loss.tone).toBe("loss");
    expect(exitByKey.unallocated_output.massKg).toBeCloseTo(300);
    expect(exitByKey.in_storage.massKg).toBeCloseTo(800);
    expect(flow.warnings).toEqual([]);
    // The batch-level ineligible exit has no facility-period analogue.
    expect(exitByKey.ineligible_feedstock).toBeUndefined();
  });

  it("clamps negative residuals to zero and records a warning", () => {
    const flow = buildStageFlow({
      feedstockInKg: 1_000,
      runOutputKg: 2_000, // output exceeds input — data inconsistency
      lotMassKg: 2_000,
      appliedKg: 2_000,
      counts: COUNTS,
    });

    expect(flow.exits.find((e) => e.key === "conversion_loss")).toBeUndefined();
    expect(flow.warnings).toContain(
      "Production-run biochar output exceeds the feedstock mass entering the runs.",
    );
  });

  it("suppresses sub-epsilon rounding residuals", () => {
    const flow = buildStageFlow({
      feedstockInKg: 1_000.4,
      runOutputKg: 1_000,
      lotMassKg: 1_000,
      appliedKg: 1_000,
      counts: COUNTS,
    });
    expect(flow.exits).toEqual([]);
    expect(flow.warnings).toEqual([]);
  });

  it("returns empty exits and no warnings for an all-zero period", () => {
    const flow = buildStageFlow({
      feedstockInKg: 0,
      runOutputKg: 0,
      lotMassKg: 0,
      appliedKg: 0,
      counts: { feedstocks: 0, productionRuns: 0, biocharLots: 0, applications: 0 },
    });
    expect(flow.exits).toEqual([]);
    expect(flow.warnings).toEqual([]);
  });
});
