import { describe, expect, it } from "vitest";
import {
  countMissedSamplings,
  countSubThreeSigmaMeasurements,
  evaluateProcessComplianceDrift,
} from "./compliance-drift";
import type { BatchSampling } from "./sampling-requirements";

function batches(...sampleCounts: number[]): BatchSampling[] {
  return sampleCounts.map((sampleCount, i) => ({
    batchId: `batch-${i + 1}`,
    batchCode: `CB-${i + 1}`,
    sampleCount,
  }));
}

/** A tight cluster (~75 ± 0.1) of `tightCount`, plus optional explicit outliers. */
function carbonPool(tightCount: number, ...outliers: number[]): number[] {
  const tight = Array.from({ length: tightCount }, (_, i) =>
    i % 2 === 0 ? 75.1 : 74.9,
  );
  return [...tight, ...outliers];
}

describe("countMissedSamplings — Method B cadence shortfall (trailing 6 mo)", () => {
  it("counts the cadence shortfall as missed samplings", () => {
    // 30 batches under Method B → require ⌈30/10⌉ = 3 sampled; only 0 sampled.
    const r = countMissedSamplings("method_b", batches(...Array(30).fill(0)));
    expect(r.requiredSampledBatches).toBe(3);
    expect(r.sampledBatches).toBe(0);
    expect(r.missedCount).toBe(3);
    expect(r.triggered).toBe(true);
  });

  it("is not triggered when the cadence is met", () => {
    // 20 batches → require 2; 2 sampled.
    const r = countMissedSamplings(
      "method_b",
      batches(3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0),
    );
    expect(r.requiredSampledBatches).toBe(2);
    expect(r.sampledBatches).toBe(2);
    expect(r.missedCount).toBe(0);
    expect(r.triggered).toBe(false);
  });

  it("flags approaching one short of the trigger", () => {
    // 20 batches → require 2; 0 sampled → missed 2 = trigger(3) − 1.
    const r = countMissedSamplings("method_b", batches(...Array(20).fill(0)));
    expect(r.missedCount).toBe(2);
    expect(r.approaching).toBe(true);
    expect(r.triggered).toBe(false);
  });
});

describe("countSubThreeSigmaMeasurements — 3σ outlier window (leave-one-out)", () => {
  it("does not apply below 30 measurements", () => {
    const r = countSubThreeSigmaMeasurements(carbonPool(10, 70, 70, 70, 70, 70));
    expect(r.applies).toBe(false);
    expect(r.belowCount).toBe(0);
    expect(r.triggered).toBe(false);
    expect(r.notes.join(" ")).toMatch(/≥ 30 measurements/);
  });

  it("flags low outliers against the leave-one-out 3σ bound and triggers at > 3", () => {
    // 60 tight values + 4 low outliers — each outlier sits below the 3σ bound of
    // the others (a whole-pool bound would let the outliers inflate σ and hide).
    const r = countSubThreeSigmaMeasurements(carbonPool(60, 70, 70, 70, 70));
    expect(r.applies).toBe(true);
    expect(r.belowCount).toBe(4);
    expect(r.triggered).toBe(true); // 4 > 3
  });

  it("flags approaching at exactly the trigger count", () => {
    const r = countSubThreeSigmaMeasurements(carbonPool(60, 70, 70, 70));
    expect(r.belowCount).toBe(3);
    expect(r.approaching).toBe(true);
    expect(r.triggered).toBe(false); // 3 is not > 3
  });

  it("reports zero outliers for a clean tight pool", () => {
    const r = countSubThreeSigmaMeasurements(carbonPool(40));
    expect(r.applies).toBe(true);
    expect(r.belowCount).toBe(0);
    expect(r.triggered).toBe(false);
  });
});

describe("evaluateProcessComplianceDrift — combined verdict", () => {
  it("anyTriggered when either counter trips", () => {
    const drift = evaluateProcessComplianceDrift({
      method: "method_b",
      batchesInWindow: batches(...Array(30).fill(0)), // missed = 3 → triggered
      carbonValuesInWindow: carbonPool(40), // clean
    });
    expect(drift.missedSamplings.triggered).toBe(true);
    expect(drift.anyTriggered).toBe(true);
    expect(drift.anyApproaching).toBe(false);
  });

  it("anyApproaching when one counter is near and none triggered", () => {
    const drift = evaluateProcessComplianceDrift({
      method: "method_b",
      batchesInWindow: batches(...Array(20).fill(0)), // missed = 2 → approaching
      carbonValuesInWindow: carbonPool(40), // clean
    });
    expect(drift.anyTriggered).toBe(false);
    expect(drift.anyApproaching).toBe(true);
  });
});
