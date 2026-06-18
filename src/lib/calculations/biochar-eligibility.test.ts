import { describe, expect, it } from "vitest";
import {
  H_TO_C_ORG_ELIGIBILITY_MAX,
  MINIMUM_REPLICATES_PER_RUN,
  O_TO_C_ORG_ELIGIBILITY_MAX,
  evaluateReplicateCount,
  evaluateRunEligibility,
} from "./biochar-eligibility";

describe("protocol thresholds (module §3 Table 2, §4)", () => {
  it("pins the eligibility ceilings and replicate minimum", () => {
    expect(H_TO_C_ORG_ELIGIBILITY_MAX).toBe(0.5);
    expect(O_TO_C_ORG_ELIGIBILITY_MAX).toBe(0.2);
    expect(MINIMUM_REPLICATES_PER_RUN).toBe(3);
  });
});

describe("evaluateRunEligibility (per-run mean, D8)", () => {
  it("passes a run whose mean H/C and O/C are below the ceilings", () => {
    const r = evaluateRunEligibility([
      { hToCOrgRatio: 0.27, oToCOrgRatio: 0.11 },
      { hToCOrgRatio: 0.29, oToCOrgRatio: 0.13 },
      { hToCOrgRatio: 0.31, oToCOrgRatio: 0.12 },
    ]);
    expect(r.meanHToCOrgRatio).toBeCloseTo(0.29, 5);
    expect(r.meanOToCOrgRatio).toBeCloseTo(0.12, 5);
    expect(r.hToCWithinThreshold).toBe(true);
    expect(r.oToCWithinThreshold).toBe(true);
    expect(r.eligible).toBe(true);
    expect(r.outlierReplicateIndexes).toEqual([]);
  });

  it("judges eligibility on the MEAN, not per replicate — one high replicate does not fail a passing mean", () => {
    // mean H/C = (0.30 + 0.30 + 0.60) / 3 = 0.40 < 0.5 → eligible, but the 0.60
    // replicate is individually ineligible and must be surfaced as an outlier.
    const r = evaluateRunEligibility([
      { hToCOrgRatio: 0.3, oToCOrgRatio: 0.1 },
      { hToCOrgRatio: 0.3, oToCOrgRatio: 0.1 },
      { hToCOrgRatio: 0.6, oToCOrgRatio: 0.1 },
    ]);
    expect(r.meanHToCOrgRatio).toBeCloseTo(0.4, 5);
    expect(r.eligible).toBe(true);
    expect(r.outlierReplicateIndexes).toEqual([2]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("fails a run whose mean H/C breaches the ceiling", () => {
    const r = evaluateRunEligibility([
      { hToCOrgRatio: 0.55, oToCOrgRatio: 0.1 },
      { hToCOrgRatio: 0.6, oToCOrgRatio: 0.1 },
    ]);
    expect(r.hToCWithinThreshold).toBe(false);
    expect(r.eligible).toBe(false);
  });

  it("fails a run whose mean O/C breaches the ceiling even when H/C passes", () => {
    const r = evaluateRunEligibility([
      { hToCOrgRatio: 0.3, oToCOrgRatio: 0.25 },
      { hToCOrgRatio: 0.3, oToCOrgRatio: 0.25 },
    ]);
    expect(r.hToCWithinThreshold).toBe(true);
    expect(r.oToCWithinThreshold).toBe(false);
    expect(r.eligible).toBe(false);
  });

  it("treats the threshold as strict (< 0.5, < 0.2) — a value exactly at the ceiling is ineligible", () => {
    const r = evaluateRunEligibility([{ hToCOrgRatio: 0.5, oToCOrgRatio: 0.2 }]);
    expect(r.hToCWithinThreshold).toBe(false);
    expect(r.oToCWithinThreshold).toBe(false);
    expect(r.eligible).toBe(false);
  });

  it("returns indeterminate (null) eligibility when a required ratio has no usable replicate", () => {
    const r = evaluateRunEligibility([
      { hToCOrgRatio: 0.3, oToCOrgRatio: null },
      { hToCOrgRatio: 0.3, oToCOrgRatio: undefined },
    ]);
    expect(r.meanHToCOrgRatio).toBeCloseTo(0.3, 5);
    expect(r.meanOToCOrgRatio).toBeNull();
    expect(r.oToCWithinThreshold).toBeNull();
    expect(r.eligible).toBeNull();
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("returns indeterminate (null) for an empty replicate set", () => {
    const r = evaluateRunEligibility([]);
    expect(r.meanHToCOrgRatio).toBeNull();
    expect(r.meanOToCOrgRatio).toBeNull();
    expect(r.eligible).toBeNull();
  });

  it("ignores non-finite ratios when averaging", () => {
    const r = evaluateRunEligibility([
      { hToCOrgRatio: 0.3, oToCOrgRatio: 0.1 },
      { hToCOrgRatio: Number.NaN, oToCOrgRatio: Number.POSITIVE_INFINITY },
      { hToCOrgRatio: 0.4, oToCOrgRatio: 0.12 },
    ]);
    expect(r.meanHToCOrgRatio).toBeCloseTo(0.35, 5);
    expect(r.meanOToCOrgRatio).toBeCloseTo(0.11, 5);
    expect(r.eligible).toBe(true);
  });
});

describe("evaluateReplicateCount (module §4 — ≥3 per run)", () => {
  it("meets the minimum at exactly 3 replicates", () => {
    const r = evaluateReplicateCount(3);
    expect(r.count).toBe(3);
    expect(r.minimum).toBe(MINIMUM_REPLICATES_PER_RUN);
    expect(r.meetsMinimum).toBe(true);
  });

  it("falls short below 3 replicates", () => {
    expect(evaluateReplicateCount(2).meetsMinimum).toBe(false);
    expect(evaluateReplicateCount(0).meetsMinimum).toBe(false);
  });

  it("meets the minimum above 3 replicates", () => {
    expect(evaluateReplicateCount(5).meetsMinimum).toBe(true);
  });
});
