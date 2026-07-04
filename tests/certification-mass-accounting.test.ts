/**
 * buildMassAccounting tests
 *
 * One lineage/run walk produces both the Review-flow `runSummary` (distinct run
 * count, total biochar output — the denominator, applied dry mass — the
 * numerator) and the submit pipeline's per-run `attributionByRunId` fraction.
 * Pinning both here is what stops the Review summary and the submit payload from
 * drifting (ADR 0003). `appliedDryKg` comes from the lineages (tonnes → kg),
 * `totalBiocharOutputKg` from the deduped runs, and lineages with no resolved
 * run contribute nothing.
 */
import { describe, expect, it } from "vitest";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import type { ProductionRunWithSamples } from "@/lib/isometric/utils/aggregation";
import {
  appliedBiocharFraction,
  buildMassAccounting,
  EMPTY_RUN_SUMMARY,
} from "@/lib/certification/mass-accounting";

function lineage(
  runId: string | null,
  appliedDryTons: number | null,
): ChainOfCustodyData {
  return {
    productionRun: runId ? { id: runId } : null,
    application: { biocharAppliedDryTons: appliedDryTons },
  } as unknown as ChainOfCustodyData;
}

function run(
  id: string,
  biocharDryMassKg: number | null,
): ProductionRunWithSamples {
  return { id, biocharDryMassKg } as unknown as ProductionRunWithSamples;
}

describe("buildMassAccounting — runSummary", () => {
  it("returns zeros for empty inputs", () => {
    expect(buildMassAccounting([], []).runSummary).toEqual(EMPTY_RUN_SUMMARY);
  });

  it("counts runs and sums their biochar output", () => {
    const { runSummary } = buildMassAccounting(
      [lineage("a", 0.5), lineage("b", 1)],
      [run("a", 1000), run("b", 2000)],
    );
    expect(runSummary.runCount).toBe(2);
    expect(runSummary.totalBiocharOutputKg).toBe(3000);
  });

  it("totals applied dry mass from the lineages, converting tonnes to kg", () => {
    // 0.5 t + 1.5 t applied → 2000 kg.
    const { runSummary } = buildMassAccounting(
      [lineage("a", 0.5), lineage("b", 1.5)],
      [run("a", 1000), run("b", 2000)],
    );
    expect(runSummary.appliedDryKg).toBe(2000);
  });

  it("ignores lineages that never resolve to a production run", () => {
    const { runSummary } = buildMassAccounting(
      [lineage(null, 3), lineage("a", 0.5)],
      [run("a", 1000)],
    );
    // The orphan lineage's 3 t does not count toward applied mass.
    expect(runSummary.appliedDryKg).toBe(500);
    expect(runSummary.runCount).toBe(1);
  });

  it("treats null applied tons and null output as zero", () => {
    const { runSummary } = buildMassAccounting(
      [lineage("a", null)],
      [run("a", null)],
    );
    expect(runSummary.appliedDryKg).toBe(0);
    expect(runSummary.totalBiocharOutputKg).toBe(0);
    expect(runSummary.runCount).toBe(1);
  });

  it("accumulates applied mass across multiple applications of the same run", () => {
    // Two applications both trace to run 'a' (1 t + 0.25 t) → 1250 kg.
    const { runSummary } = buildMassAccounting(
      [lineage("a", 1), lineage("a", 0.25)],
      [run("a", 2000)],
    );
    expect(runSummary.appliedDryKg).toBe(1250);
    expect(runSummary.totalBiocharOutputKg).toBe(2000);
    expect(runSummary.runCount).toBe(1);
  });
});

describe("buildMassAccounting — attributionByRunId", () => {
  it("has no entries for empty inputs", () => {
    expect(buildMassAccounting([], []).attributionByRunId.size).toBe(0);
  });

  it("is the applied-over-output fraction per run", () => {
    // run a: 0.5 t (500 kg) of 1000 kg output → 0.5
    // run b: 1.5 t (1500 kg) of 2000 kg output → 0.75
    const { attributionByRunId } = buildMassAccounting(
      [lineage("a", 0.5), lineage("b", 1.5)],
      [run("a", 1000), run("b", 2000)],
    );
    expect(attributionByRunId.get("a")).toBe(0.5);
    expect(attributionByRunId.get("b")).toBe(0.75);
  });

  it("accumulates applied mass across applications before dividing by output", () => {
    // a: (1 t + 0.25 t) = 1250 kg of 2000 kg → 0.625
    const { attributionByRunId } = buildMassAccounting(
      [lineage("a", 1), lineage("a", 0.25)],
      [run("a", 2000)],
    );
    expect(attributionByRunId.get("a")).toBe(0.625);
  });

  it("falls back to full attribution (1) when a run's output is null or zero", () => {
    const { attributionByRunId } = buildMassAccounting(
      [lineage("a", 0.5), lineage("b", 0.5)],
      [run("a", null), run("b", 0)],
    );
    expect(attributionByRunId.get("a")).toBe(1);
    expect(attributionByRunId.get("b")).toBe(1);
  });

  it("attributes zero to a run with output but no applied lineage", () => {
    const { attributionByRunId } = buildMassAccounting([], [run("a", 1000)]);
    expect(attributionByRunId.get("a")).toBe(0);
  });
});

// §8.6.2 delivery bucket (issue #349, ADR 0020): the ONE shared removal-wide
// fraction — the submitted biochar-transport scalar and the evidence-ledger
// PDF's "× applied share" line both derive from it.
describe("appliedBiocharFraction", () => {
  it("is appliedDryKg over totalBiocharOutputKg", () => {
    expect(
      appliedBiocharFraction({
        runCount: 1,
        totalBiocharOutputKg: 1000,
        appliedDryKg: 400,
      }),
    ).toBe(0.4);
  });

  it("falls back to full attribution (1) when output is zero", () => {
    expect(appliedBiocharFraction(EMPTY_RUN_SUMMARY)).toBe(1);
  });
});
