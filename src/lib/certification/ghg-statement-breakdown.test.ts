import { describe, expect, it } from "vitest";

import {
  computeGhgStatementBreakdown,
  type GhgStatementBreakdownInput,
  type GhgStatementEntryFigures,
} from "./ghg-statement-breakdown";

// A statement rolling up two removals. The flattened member batches mirror the
// single-removal fixture (1.040 t sequestered, 0.741 t emitted → 299 kg local
// net-before-discount), so the local estimate reconciles with the registry
// roll-up below.
function input(
  overrides: Partial<GhgStatementBreakdownInput> = {},
): GhgStatementBreakdownInput {
  return {
    sequestrationTonnesByBatch: [0.64, 0.4],
    emissionsTonnesByBatch: [0.441, 0.3],
    counterfactualTonnesByBatch: [null, null],
    missingInputs: [],
    memberBatchCount: 2,
    entries: [],
    creditAllocation: null,
    ghgStatementId: null,
    ghgStatementStatus: null,
    ...overrides,
  };
}

// Two member GHG entries that sum to the screenshot figures: 284 kg net, 299 kg
// before the uncertainty haircut (a 15 kg discount). Standard deviations 3 and
// 4 combine in quadrature to 5 (√(9+16)), never 7.
const ENTRIES: GhgStatementEntryFigures[] = [
  { netRemovedKg: 142, netBeforeDiscountKg: 149.5, standardDeviationKg: 3 },
  { netRemovedKg: 142, netBeforeDiscountKg: 149.5, standardDeviationKg: 4 },
];

// Buffer 34 kg of 284 kg issuable → 12.0% effective reversal rate.
const ALLOCATION = { bufferCreditsKg: 34, supplierCreditsKg: 250 };

describe("computeGhgStatementBreakdown — estimate mode (no entries)", () => {
  it("sums the flattened member batches into the local net", () => {
    const result = computeGhgStatementBreakdown(input());
    expect(result.source).toBe("estimate");
    expect(result.sequestrationKg).toBeCloseTo(1040, 6);
    expect(result.activitiesKg).toBeCloseTo(741, 6);
    // 1040 − 741 = 299
    expect(result.netRemovedKg).toBeCloseTo(299, 6);
    expect(result.uncertaintyDiscountKg).toBeNull();
    expect(result.bufferPoolPercent).toBeNull();
    expect(result.reconciles).toBe(false);
  });

  it("reports no data when nothing is computable and no entries exist", () => {
    const result = computeGhgStatementBreakdown(
      input({
        sequestrationTonnesByBatch: [null, null],
        emissionsTonnesByBatch: [null, null],
      }),
    );
    expect(result.hasAnyData).toBe(false);
    expect(result.anomalies).toEqual([]);
  });
});

describe("computeGhgStatementBreakdown — registry mode", () => {
  it("sums entry nets linearly and derives the aggregate uncertainty discount", () => {
    const result = computeGhgStatementBreakdown(
      input({ entries: ENTRIES, creditAllocation: ALLOCATION }),
    );
    expect(result.source).toBe("registry");
    expect(result.netRemovedKg).toBeCloseTo(284, 6);
    expect(result.netBeforeDiscountKg).toBeCloseTo(299, 6);
    // discount = Σwithout − Σnet = 299 − 284
    expect(result.uncertaintyDiscountKg).toBeCloseTo(15, 6);
  });

  it("combines standard deviations in quadrature, not linearly", () => {
    const result = computeGhgStatementBreakdown(
      input({ entries: ENTRIES, creditAllocation: ALLOCATION }),
    );
    // √(3² + 4²) = 5, never 3 + 4 = 7
    expect(result.standardDeviationKg).toBeCloseTo(5, 6);
  });

  it("returns a null std-dev when any member entry omits its own", () => {
    const result = computeGhgStatementBreakdown(
      input({
        entries: [
          ENTRIES[0],
          { ...ENTRIES[1], standardDeviationKg: null },
        ],
        creditAllocation: ALLOCATION,
      }),
    );
    expect(result.standardDeviationKg).toBeNull();
  });

  it("derives the buffer-pool rate from the statement credit allocation", () => {
    const result = computeGhgStatementBreakdown(
      input({ entries: ENTRIES, creditAllocation: ALLOCATION }),
    );
    // 34 / (34 + 250) = 11.97% → rounded to a tenth = 12.0
    expect(result.bufferPoolPercent).toBeCloseTo(12, 6);
    expect(result.bufferCreditsKg).toBe(34);
    expect(result.supplierCreditsKg).toBe(250);
  });

  it("leaves the buffer split null when the registry has not set it", () => {
    const result = computeGhgStatementBreakdown(
      input({ entries: ENTRIES, creditAllocation: null }),
    );
    expect(result.source).toBe("registry");
    expect(result.bufferPoolPercent).toBeNull();
    expect(result.bufferCreditsKg).toBeNull();
    expect(result.supplierCreditsKg).toBeNull();
  });

  it("reconciles when the local estimate matches the registry roll-up", () => {
    // local 1040 − 741 = 299 == Σ without_discount (149.5 + 149.5)
    const result = computeGhgStatementBreakdown(
      input({ entries: ENTRIES, creditAllocation: ALLOCATION }),
    );
    expect(result.reconciles).toBe(true);
  });

  it("flags divergence but keeps the registry net authoritative", () => {
    const result = computeGhgStatementBreakdown(
      input({
        emissionsTonnesByBatch: [0.2, 0.2], // local net-before = 640, not 299
        entries: ENTRIES,
        creditAllocation: ALLOCATION,
      }),
    );
    expect(result.reconciles).toBe(false);
    expect(result.netRemovedKg).toBeCloseTo(284, 6);
  });

  it("still rolls up the registry net when the local preview is incomplete", () => {
    const result = computeGhgStatementBreakdown(
      input({
        sequestrationTonnesByBatch: [0.64, null],
        entries: ENTRIES,
        creditAllocation: ALLOCATION,
      }),
    );
    expect(result.sequestrationKg).toBeNull();
    expect(result.netRemovedKg).toBeCloseTo(284, 6);
    expect(result.hasAnyData).toBe(true);
  });
});
