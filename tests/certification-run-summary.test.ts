/**
 * buildRunSummary tests
 *
 * The focused aggregate the guided Review flow shows for a removal: distinct
 * run count, total biochar output (raw, the denominator), and applied dry mass
 * reaching this removal's applications (the numerator). Pins the math —
 * `appliedDryKg` comes from the lineages (tonnes → kg), `totalBiocharOutputKg`
 * from the deduped runs, and lineages with no resolved run contribute nothing.
 */
import { describe, expect, it } from "vitest";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import type { ProductionRunWithSamples } from "@/lib/isometric/utils/aggregation";
import {
  buildRunSummary,
  EMPTY_RUN_SUMMARY,
} from "@/lib/certification/run-summary";

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

describe("buildRunSummary", () => {
  it("returns zeros for empty inputs", () => {
    expect(buildRunSummary([], [])).toEqual(EMPTY_RUN_SUMMARY);
  });

  it("counts runs and sums their biochar output", () => {
    const summary = buildRunSummary(
      [lineage("a", 0.5), lineage("b", 1)],
      [run("a", 1000), run("b", 2000)],
    );
    expect(summary.runCount).toBe(2);
    expect(summary.totalBiocharOutputKg).toBe(3000);
  });

  it("totals applied dry mass from the lineages, converting tonnes to kg", () => {
    // 0.5 t + 1.5 t applied → 2000 kg.
    const summary = buildRunSummary(
      [lineage("a", 0.5), lineage("b", 1.5)],
      [run("a", 1000), run("b", 2000)],
    );
    expect(summary.appliedDryKg).toBe(2000);
  });

  it("ignores lineages that never resolve to a production run", () => {
    const summary = buildRunSummary(
      [lineage(null, 3), lineage("a", 0.5)],
      [run("a", 1000)],
    );
    // The orphan lineage's 3 t does not count toward applied mass.
    expect(summary.appliedDryKg).toBe(500);
    expect(summary.runCount).toBe(1);
  });

  it("treats null applied tons and null output as zero", () => {
    const summary = buildRunSummary(
      [lineage("a", null)],
      [run("a", null)],
    );
    expect(summary.appliedDryKg).toBe(0);
    expect(summary.totalBiocharOutputKg).toBe(0);
    expect(summary.runCount).toBe(1);
  });

  it("accumulates applied mass across multiple applications of the same run", () => {
    // Two applications both trace to run 'a' (1 t + 0.25 t) → 1250 kg.
    const summary = buildRunSummary(
      [lineage("a", 1), lineage("a", 0.25)],
      [run("a", 2000)],
    );
    expect(summary.appliedDryKg).toBe(1250);
    expect(summary.totalBiocharOutputKg).toBe(2000);
    expect(summary.runCount).toBe(1);
  });
});
