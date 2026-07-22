import { describe, expect, it } from "vitest";
import {
  evaluateDurabilitySubmissionGates,
  type BatchGateFacts,
  type ReplicateProvenance,
} from "./durability-submission-gates";

// Default provenance distributes replicates across distinct runs/days so the
// cluster warning stays silent unless a test deliberately clusters them.
function distributedProvenance(n: number): ReplicateProvenance[] {
  return Array.from({ length: n }, (_, i) => ({
    sampleCode: `SAM-${i + 1}`,
    productionRunId: `run-${i}`,
    samplingDay: `2026-06-0${(i % 9) + 1}`,
  }));
}

function gateBatch(overrides: Partial<BatchGateFacts>): BatchGateFacts {
  const replicates = overrides.replicates ?? [];
  return {
    creditBatchId: "batch-1",
    creditBatchCode: "CB-1",
    startDate: "2026-06-01",
    endDate: "2026-06-30",
    sampling: "sampled",
    replicates,
    replicateProvenance:
      overrides.replicateProvenance ?? distributedProvenance(replicates.length),
    ...overrides,
  };
}

const eligibleTriplet = [
  { hToCOrgRatio: 0.28, oToCOrgRatio: 0.11 },
  { hToCOrgRatio: 0.3, oToCOrgRatio: 0.12 },
  { hToCOrgRatio: 0.32, oToCOrgRatio: 0.13 },
];

describe("evaluateDurabilitySubmissionGates (D3 fail-closed blocks, credit-batch grain)", () => {
  it("passes a sampled batch with ≥3 eligible replicates distributed across runs/days", () => {
    const r = evaluateDurabilitySubmissionGates([
      gateBatch({ replicates: eligibleTriplet }),
    ]);
    expect(r.ok).toBe(true);
    expect(r.blockers).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("blocks a sampled batch with no samples (gate b)", () => {
    const r = evaluateDurabilitySubmissionGates([
      gateBatch({ sampling: "sampled", replicates: [] }),
    ]);
    expect(r.ok).toBe(false);
    expect(r.blockers.some((b) => /CB-1/.test(b) && /marked sampled/i.test(b))).toBe(true);
  });

  it("allows a batch stored as unsampled without local sample evidence", () => {
    const r = evaluateDurabilitySubmissionGates([
      gateBatch({ sampling: "unsampled", replicates: [] }),
    ]);
    expect(r.ok).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  it("does not reclassify an unsampled batch when incidental samples exist", () => {
    const r = evaluateDurabilitySubmissionGates([
      gateBatch({
        sampling: "unsampled",
        replicates: [{ hToCOrgRatio: null, oToCOrgRatio: null }],
      }),
    ]);
    expect(r.ok).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  it("blocks a sampled batch with fewer than 3 replicates (gate c)", () => {
    const r = evaluateDurabilitySubmissionGates([
      gateBatch({ replicates: eligibleTriplet.slice(0, 2) }),
    ]);
    expect(r.ok).toBe(false);
    expect(r.blockers.some((b) => /replicate/i.test(b) && /3/.test(b))).toBe(true);
  });

  it("blocks a batch whose mean H/C_org exceeds the eligibility ceiling (gate a)", () => {
    const r = evaluateDurabilitySubmissionGates([
      gateBatch({
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

  it("blocks a sampled batch with indeterminate eligibility (missing O/C_org)", () => {
    const r = evaluateDurabilitySubmissionGates([
      gateBatch({
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

  it("warns (does not block) when ≥3 eligible replicates cluster on a single run/day (§8.3.1)", () => {
    const clustered: ReplicateProvenance[] = [
      { sampleCode: "SAM-1", productionRunId: "run-1", samplingDay: "2026-06-01" },
      { sampleCode: "SAM-2", productionRunId: "run-1", samplingDay: "2026-06-01" },
      { sampleCode: "SAM-3", productionRunId: "run-1", samplingDay: "2026-06-01" },
    ];
    const r = evaluateDurabilitySubmissionGates([
      gateBatch({ replicates: eligibleTriplet, replicateProvenance: clustered }),
    ]);
    expect(r.ok).toBe(true);
    expect(r.blockers).toEqual([]);
    expect(r.warnings.some((w) => /cluster/i.test(w) && /8\.3\.1/.test(w))).toBe(true);
  });

  it("still warns when the 3 complete replicates cluster but an incomplete off-day sample spreads the raw provenance (§8.3.1)", () => {
    // Regression (PR #296 review): the cluster check must judge only the USABLE
    // (complete-chemistry) replicates, not every raw sample. Three complete
    // replicates all on run-1/2026-06-01 + one incomplete sample (missing O/C_org)
    // on run-2/2026-06-02 → usableReplicateCount stays 3 (gate c passes), and the
    // incomplete off-day sample must NOT mask that the usable set clusters.
    const replicates = [
      ...eligibleTriplet,
      { hToCOrgRatio: 0.31, oToCOrgRatio: null },
    ];
    const replicateProvenance: ReplicateProvenance[] = [
      { sampleCode: "SAM-1", productionRunId: "run-1", samplingDay: "2026-06-01" },
      { sampleCode: "SAM-2", productionRunId: "run-1", samplingDay: "2026-06-01" },
      { sampleCode: "SAM-3", productionRunId: "run-1", samplingDay: "2026-06-01" },
      { sampleCode: "SAM-4", productionRunId: "run-2", samplingDay: "2026-06-02" },
    ];
    const r = evaluateDurabilitySubmissionGates([
      gateBatch({ replicates, replicateProvenance }),
    ]);
    expect(r.ok).toBe(true);
    expect(r.blockers).toEqual([]);
    expect(r.warnings.some((w) => /cluster/i.test(w) && /8\.3\.1/.test(w))).toBe(true);
  });

  it("warns distinctly when ≥3 eligible replicates have unknown run/day provenance", () => {
    const unknown: ReplicateProvenance[] = [
      { sampleCode: "SAM-1", productionRunId: null, samplingDay: null },
      { sampleCode: "SAM-2", productionRunId: null, samplingDay: null },
      { sampleCode: "SAM-3", productionRunId: null, samplingDay: null },
    ];
    const r = evaluateDurabilitySubmissionGates([
      gateBatch({ replicates: eligibleTriplet, replicateProvenance: unknown }),
    ]);
    expect(r.ok).toBe(true);
    expect(r.blockers).toEqual([]);
    expect(r.warnings.some((w) => /unknown run\/day provenance/i.test(w))).toBe(
      true,
    );
    expect(r.warnings.every((w) => !/single run\/day/i.test(w))).toBe(true);
  });

  it("aggregates blockers across multiple batches", () => {
    const r = evaluateDurabilitySubmissionGates([
      gateBatch({ creditBatchId: "a", creditBatchCode: "CB-A", replicates: eligibleTriplet }),
      gateBatch({ creditBatchId: "b", creditBatchCode: "CB-B", sampling: "sampled", replicates: [] }),
      gateBatch({ creditBatchId: "c", creditBatchCode: "CB-C", replicates: eligibleTriplet.slice(0, 1) }),
    ]);
    expect(r.ok).toBe(false);
    expect(r.blockers.some((b) => /CB-B/.test(b))).toBe(true);
    expect(r.blockers.some((b) => /CB-C/.test(b))).toBe(true);
    expect(r.blockers.some((b) => /CB-A/.test(b))).toBe(false);
  });

  it("passes an empty batch set (nothing to gate)", () => {
    expect(evaluateDurabilitySubmissionGates([])).toEqual({
      ok: true,
      blockers: [],
      warnings: [],
    });
  });

  it("blocks a sample dated before its credit-batch production window", () => {
    const r = evaluateDurabilitySubmissionGates([
      gateBatch({
        replicates: eligibleTriplet,
        replicateProvenance: [
          { sampleCode: "SAM-26-003", productionRunId: "run-1", samplingDay: "2026-05-31" },
          { sampleCode: "SAM-26-004", productionRunId: "run-1", samplingDay: "2026-06-02" },
          { sampleCode: "SAM-26-005", productionRunId: "run-1", samplingDay: "2026-06-03" },
        ],
      }),
    ]);

    expect(r.ok).toBe(false);
    expect(r.blockers.some((b) => /SAM-26-003/.test(b) && /2026-06-01–2026-06-30/.test(b) && /8\.3\.1/.test(b))).toBe(true);
  });

  it("counts a post-window sample as usable but excludes its day from temporal distribution", () => {
    const r = evaluateDurabilitySubmissionGates([
      gateBatch({
        replicates: eligibleTriplet,
        replicateProvenance: [
          { sampleCode: "SAM-26-001", productionRunId: "run-1", samplingDay: "2026-06-15" },
          { sampleCode: "SAM-26-002", productionRunId: "run-1", samplingDay: "2026-06-15" },
          { sampleCode: "SAM-26-003", productionRunId: "run-1", samplingDay: "2026-07-20" },
        ],
      }),
    ]);

    expect(r.ok).toBe(true);
    expect(r.blockers.every((b) => !/replicate/.test(b))).toBe(true);
    expect(r.warnings.some((w) => /SAM-26-003/.test(w) && /stored material/.test(w) && /registry/.test(w))).toBe(true);
    expect(r.warnings.some((w) => /single run\/day/.test(w))).toBe(true);
  });

  it("leaves distinct in-window sampling days unchanged", () => {
    const r = evaluateDurabilitySubmissionGates([
      gateBatch({ replicates: eligibleTriplet }),
    ]);

    expect(r.ok).toBe(true);
    expect(r.blockers).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
});
