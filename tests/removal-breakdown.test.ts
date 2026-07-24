import { describe, expect, it } from "vitest";
import {
  computeRemovalBreakdown,
  type RemovalBreakdownInput,
} from "@/lib/certification/removal-breakdown";

function input(
  overrides: Partial<RemovalBreakdownInput> = {},
): RemovalBreakdownInput {
  return {
    sequestrationTonnesByBatch: [],
    emissionsTonnesByBatch: [],
    counterfactualTonnesByBatch: [],
    missingInputs: [],
    memberBatchCount: 0,
    registry: null,
    ...overrides,
  };
}

describe("computeRemovalBreakdown — hasAnyData", () => {
  it("has no data when there is no preview and no registry", () => {
    const result = computeRemovalBreakdown(input());

    expect(result.source).toBe("estimate");
    expect(result.hasAnyData).toBe(false);
    expect(result.sequestrationKg).toBeNull();
    expect(result.netRemovedKg).toBeNull();
  });

  it("counts partial sequestration as data even when the preview is incomplete", () => {
    // One batch resolved, one still pending: the total can't be computed, but the
    // roll-up has *something* to show, so the estimate card should render.
    const result = computeRemovalBreakdown(
      input({
        sequestrationTonnesByBatch: [1.5, null],
        memberBatchCount: 2,
        missingInputs: ["batch-2 preview"],
      }),
    );

    expect(result.sequestrationComplete).toBe(false);
    expect(result.sequestrationKg).toBeNull();
    expect(result.hasAnyData).toBe(true);
  });

  it("counts data when only emissions are recorded", () => {
    const result = computeRemovalBreakdown(
      input({
        sequestrationTonnesByBatch: [null],
        emissionsTonnesByBatch: [0.25],
        memberBatchCount: 1,
      }),
    );

    expect(result.activitiesRecorded).toBe(true);
    expect(result.hasAnyData).toBe(true);
  });

  it("computes a local net estimate once sequestration is complete", () => {
    const result = computeRemovalBreakdown(
      input({
        sequestrationTonnesByBatch: [1.5, 0.5],
        emissionsTonnesByBatch: [0.25],
        counterfactualTonnesByBatch: [0.125],
        memberBatchCount: 2,
      }),
    );

    expect(result.source).toBe("estimate");
    expect(result.sequestrationComplete).toBe(true);
    expect(result.sequestrationKg).toBeCloseTo(2000, 6);
    // 2000 − 250 − 125
    expect(result.netRemovedKg).toBeCloseTo(1625, 6);
    expect(result.hasAnyData).toBe(true);
  });

  it("always has data in registry mode, even with no local preview", () => {
    const result = computeRemovalBreakdown(
      input({
        registry: {
          netRemovedKg: 900,
          netBeforeDiscountKg: 1000,
          standardDeviationKg: 50,
          riskOfReversalPercent: 4,
          bufferCreditsKg: 40,
          supplierCreditsKg: 860,
          ghgStatementId: null,
          ghgStatementStatus: null,
        },
      }),
    );

    expect(result.source).toBe("registry");
    expect(result.hasAnyData).toBe(true);
    expect(result.netRemovedKg).toBe(900);
    // 1000 − 900
    expect(result.uncertaintyDiscountKg).toBeCloseTo(100, 6);
    // No local sequestration to reconcile against.
    expect(result.reconciles).toBe(false);
  });
});
