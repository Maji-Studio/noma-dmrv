import { describe, expect, it } from "vitest";

import {
  computeRemovalBreakdown,
  type RemovalBreakdownInput,
  type RemovalBreakdownRegistryInput,
} from "./removal-breakdown";

// Two batches whose previews resolve cleanly: 1.040 t sequestered, 0.741 t
// emitted — the registry example from the GHG-entry breakdown screenshot,
// expressed across members (kg figures land at 1040 / 741 once summed).
function input(overrides: Partial<RemovalBreakdownInput> = {}): RemovalBreakdownInput {
  return {
    sequestrationTonnesByBatch: [0.64, 0.4],
    emissionsTonnesByBatch: [0.441, 0.3],
    counterfactualTonnesByBatch: [null, null],
    missingInputs: [],
    memberBatchCount: 2,
    registry: null,
    ...overrides,
  };
}

// Registry read-back that matches the screenshot: 284 kg net, 299 kg before the
// uncertainty haircut (a 15 kg discount), 12% buffer.
const REGISTRY: RemovalBreakdownRegistryInput = {
  netRemovedKg: 284,
  netBeforeDiscountKg: 299,
  standardDeviationKg: 15,
  riskOfReversalPercent: 12,
  bufferCreditsKg: 34,
  supplierCreditsKg: 250,
};

describe("computeRemovalBreakdown — estimate mode (no registry)", () => {
  it("sums member batches into kg and derives the local net", () => {
    const result = computeRemovalBreakdown(input());
    expect(result.source).toBe("estimate");
    expect(result.sequestrationKg).toBeCloseTo(1040, 6);
    expect(result.activitiesKg).toBeCloseTo(741, 6);
    expect(result.counterfactualKg).toBe(0);
    // 1040 − 741 − 0 = 299 (the pre-uncertainty figure)
    expect(result.localNetBeforeDiscountKg).toBeCloseTo(299, 6);
    expect(result.netRemovedKg).toBeCloseTo(299, 6);
  });

  it("leaves uncertainty unknown — only the registry applies the haircut", () => {
    const result = computeRemovalBreakdown(input());
    expect(result.uncertaintyDiscountKg).toBeNull();
    expect(result.standardDeviationKg).toBeNull();
    expect(result.bufferPoolPercent).toBeNull();
    expect(result.reconciles).toBe(false);
  });

  it("subtracts the counterfactual baseline when recorded", () => {
    const result = computeRemovalBreakdown(
      input({ counterfactualTonnesByBatch: [0.05, 0.05] }),
    );
    expect(result.counterfactualRecorded).toBe(true);
    expect(result.counterfactualKg).toBeCloseTo(100, 6);
    expect(result.localNetBeforeDiscountKg).toBeCloseTo(199, 6);
  });

  it("withholds sequestration until every batch preview resolves", () => {
    const result = computeRemovalBreakdown(
      input({
        sequestrationTonnesByBatch: [0.64, null],
        missingInputs: ["1000YearDurabilityEngine"],
      }),
    );
    expect(result.sequestrationComplete).toBe(false);
    expect(result.sequestrationKg).toBeNull();
    expect(result.localNetBeforeDiscountKg).toBeNull();
    expect(result.netRemovedKg).toBeNull();
    expect(result.missingInputs).toEqual(["1000YearDurabilityEngine"]);
  });

  it("treats unrecorded emissions as zero but flags it", () => {
    const result = computeRemovalBreakdown(
      input({ emissionsTonnesByBatch: [null, null] }),
    );
    expect(result.activitiesRecorded).toBe(false);
    expect(result.activitiesKg).toBe(0);
    expect(result.localNetBeforeDiscountKg).toBeCloseTo(1040, 6);
  });

  it("reports no data when nothing is computable", () => {
    const result = computeRemovalBreakdown(
      input({
        sequestrationTonnesByBatch: [null, null],
        emissionsTonnesByBatch: [null, null],
      }),
    );
    expect(result.hasAnyData).toBe(false);
  });
});

describe("computeRemovalBreakdown — registry mode", () => {
  it("uses the registry's authoritative net and derives the uncertainty discount", () => {
    const result = computeRemovalBreakdown(input({ registry: REGISTRY }));
    expect(result.source).toBe("registry");
    expect(result.netRemovedKg).toBe(284);
    expect(result.netBeforeDiscountKg).toBe(299);
    // discount = 299 − 284
    expect(result.uncertaintyDiscountKg).toBe(15);
    expect(result.standardDeviationKg).toBe(15);
    expect(result.bufferPoolPercent).toBe(12);
    expect(result.bufferCreditsKg).toBe(34);
  });

  it("reconciles when the local pre-uncertainty figure matches the registry", () => {
    // local: 1040 − 741 = 299, registry netBeforeDiscount 299 → reconciles
    const result = computeRemovalBreakdown(input({ registry: REGISTRY }));
    expect(result.reconciles).toBe(true);
  });

  it("flags divergence when local inputs drift from the registry", () => {
    const result = computeRemovalBreakdown(
      input({
        emissionsTonnesByBatch: [0.2, 0.2], // local net-before = 640, not 299
        registry: REGISTRY,
      }),
    );
    expect(result.reconciles).toBe(false);
    // registry figures still win the headline
    expect(result.netRemovedKg).toBe(284);
  });

  it("still shows the registry net when the local preview is incomplete", () => {
    const result = computeRemovalBreakdown(
      input({
        sequestrationTonnesByBatch: [0.64, null],
        registry: REGISTRY,
      }),
    );
    expect(result.sequestrationKg).toBeNull();
    expect(result.reconciles).toBe(false);
    expect(result.netRemovedKg).toBe(284);
    expect(result.hasAnyData).toBe(true);
  });

  it("never produces a negative uncertainty discount", () => {
    const result = computeRemovalBreakdown(
      input({
        registry: { ...REGISTRY, netBeforeDiscountKg: 280, netRemovedKg: 284 },
      }),
    );
    expect(result.uncertaintyDiscountKg).toBe(0);
  });
});
