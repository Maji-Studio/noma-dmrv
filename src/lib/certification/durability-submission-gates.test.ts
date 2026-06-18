import { describe, expect, it } from "vitest";
import {
  evaluateDurabilitySubmissionGates,
  type RunGateFacts,
} from "./durability-submission-gates";

function gateRun(overrides: Partial<RunGateFacts>): RunGateFacts {
  return {
    runId: "run-1",
    runCode: "PR-1",
    samplingMethod: "method_a",
    replicates: [],
    ...overrides,
  };
}

const eligibleTriplet = [
  { hToCOrgRatio: 0.28, oToCOrgRatio: 0.11 },
  { hToCOrgRatio: 0.3, oToCOrgRatio: 0.12 },
  { hToCOrgRatio: 0.32, oToCOrgRatio: 0.13 },
];

describe("evaluateDurabilitySubmissionGates (D3 fail-closed blocks)", () => {
  it("passes a Method A run with ≥3 eligible replicates", () => {
    const r = evaluateDurabilitySubmissionGates([
      gateRun({ replicates: eligibleTriplet }),
    ]);
    expect(r.ok).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  it("blocks a Method A run with no samples (gate b)", () => {
    const r = evaluateDurabilitySubmissionGates([
      gateRun({ samplingMethod: "method_a", replicates: [] }),
    ]);
    expect(r.ok).toBe(false);
    expect(r.blockers.some((b) => /PR-1/.test(b) && /method a/i.test(b))).toBe(true);
  });

  it("allows a Method B run with no samples (covered by the unsampled blueprint)", () => {
    const r = evaluateDurabilitySubmissionGates([
      gateRun({ samplingMethod: "method_b", replicates: [] }),
    ]);
    expect(r.ok).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  it("blocks a sampled run with fewer than 3 replicates (gate c)", () => {
    const r = evaluateDurabilitySubmissionGates([
      gateRun({ replicates: eligibleTriplet.slice(0, 2) }),
    ]);
    expect(r.ok).toBe(false);
    expect(r.blockers.some((b) => /replicate/i.test(b) && /3/.test(b))).toBe(true);
  });

  it("blocks a run whose mean H/C_org exceeds the eligibility ceiling (gate a)", () => {
    const r = evaluateDurabilitySubmissionGates([
      gateRun({
        replicates: [
          { hToCOrgRatio: 0.55, oToCOrgRatio: 0.1 },
          { hToCOrgRatio: 0.6, oToCOrgRatio: 0.1 },
          { hToCOrgRatio: 0.58, oToCOrgRatio: 0.1 },
        ],
      }),
    ]);
    expect(r.ok).toBe(false);
    expect(r.blockers.some((b) => /eligib/i.test(b))).toBe(true);
  });

  it("blocks a sampled run with indeterminate eligibility (missing O/C_org)", () => {
    const r = evaluateDurabilitySubmissionGates([
      gateRun({
        replicates: [
          { hToCOrgRatio: 0.3, oToCOrgRatio: null },
          { hToCOrgRatio: 0.3, oToCOrgRatio: null },
          { hToCOrgRatio: 0.3, oToCOrgRatio: null },
        ],
      }),
    ]);
    expect(r.ok).toBe(false);
    expect(r.blockers.some((b) => /indeterminate|cannot confirm|missing/i.test(b))).toBe(true);
  });

  it("aggregates blockers across multiple runs", () => {
    const r = evaluateDurabilitySubmissionGates([
      gateRun({ runId: "a", runCode: "PR-A", replicates: eligibleTriplet }),
      gateRun({ runId: "b", runCode: "PR-B", samplingMethod: "method_a", replicates: [] }),
      gateRun({ runId: "c", runCode: "PR-C", replicates: eligibleTriplet.slice(0, 1) }),
    ]);
    expect(r.ok).toBe(false);
    expect(r.blockers.some((b) => /PR-B/.test(b))).toBe(true);
    expect(r.blockers.some((b) => /PR-C/.test(b))).toBe(true);
    expect(r.blockers.some((b) => /PR-A/.test(b))).toBe(false);
  });

  it("passes an empty run set (nothing to gate)", () => {
    expect(evaluateDurabilitySubmissionGates([])).toEqual({ ok: true, blockers: [] });
  });
});
