import { describe, expect, it } from "vitest";
import {
  evaluateDurabilitySubmissionGates,
  type RunGateFacts,
} from "./durability-submission-gates";

function gateRun(overrides: Partial<RunGateFacts>): RunGateFacts {
  return {
    runId: "run-1",
    runCode: "PR-1",
    reactorId: "rct-1",
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

  it("allows unsampled Method B runs when the 1-in-10 cadence is met across the set", () => {
    // 1 sampled batch (≥3 eligible replicates) + 9 unsampled = ceil(10/10)=1 met.
    const runs: RunGateFacts[] = [
      gateRun({
        runId: "r0",
        runCode: "PR-B0",
        samplingMethod: "method_b",
        replicates: eligibleTriplet,
      }),
    ];
    for (let i = 1; i < 10; i++) {
      runs.push(
        gateRun({
          runId: `r${i}`,
          runCode: `PR-B${i}`,
          samplingMethod: "method_b",
          replicates: [],
        }),
      );
    }
    const r = evaluateDurabilitySubmissionGates(runs);
    expect(r.ok).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  it("blocks an all-unsampled Method B run set (cadence shortfall, gate d)", () => {
    const r = evaluateDurabilitySubmissionGates([
      gateRun({ runId: "r1", runCode: "PR-B1", samplingMethod: "method_b", replicates: [] }),
      gateRun({ runId: "r2", runCode: "PR-B2", samplingMethod: "method_b", replicates: [] }),
    ]);
    expect(r.ok).toBe(false);
    expect(
      r.blockers.some((b) => /method b/i.test(b) && /8\.3\.1\.2/.test(b)),
    ).toBe(true);
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
