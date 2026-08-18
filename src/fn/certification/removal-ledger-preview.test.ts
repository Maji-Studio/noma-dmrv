import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  aggregateProductionRuns,
  enrichWithTransportLegs,
  type ProductionRunWithSamples,
} from "@/lib/isometric";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import type { RemovalRunSummary } from "@/lib/certification/mass-accounting";
import { buildRemovalLedgerPreview } from "./removal-ledger-preview";

vi.mock("@/lib/isometric", () => ({
  aggregateProductionRuns: vi.fn(),
  enrichWithTransportLegs: vi.fn(),
}));

vi.mock("@/lib/log", () => ({
  logger: { warn: vi.fn() },
  sanitizeErrorMessage: (error: unknown) => String(error),
}));

const AGGREGATE = {
  totalBiocharDryMassKg: 2_500,
  totalFeedstockDryMassKg: 5_000,
  totalDieselLitres: 12,
  totalElectricityKwh: 30,
  feedstockTransportMassDistanceTonneKm: 40,
  biocharTransportMassDistanceTonneKm: 50,
  sampleTransportMassDistanceTonneKm: 6,
};

function lineage(
  applicationId: string,
  applicationCode: string,
): ChainOfCustodyData {
  return {
    application: { id: applicationId, code: applicationCode },
    delivery: { code: `DL-${applicationCode}` },
  } as ChainOfCustodyData;
}

function run(id: string): ProductionRunWithSamples {
  return { id, code: id.toUpperCase() } as ProductionRunWithSamples;
}

const RUN_SUMMARY = {
  runCount: 1,
  appliedDryKg: 1_000,
  totalBiocharOutputKg: 2_000,
  deliveryBiocharOutputKg: 2_000,
} satisfies RemovalRunSummary;

describe("buildRemovalLedgerPreview", () => {
  beforeEach(() => {
    vi.mocked(aggregateProductionRuns).mockReturnValue(AGGREGATE as never);
    vi.mocked(enrichWithTransportLegs).mockReturnValue(AGGREGATE as never);
  });

  it("projects mixed production claims, transport inputs, and batch-aware links", () => {
    const preview = buildRemovalLedgerPreview({
      removalId: "removal-current",
      memberBatchClaims: [
        {
          creditBatchId: "batch-1",
          code: "CB-1",
          claimedByRemovalId: null,
          productionRunIds: ["run-1"],
          applicationIds: ["application-1"],
          applicationSlices: [{ applicationId: "application-1" }],
        },
        {
          creditBatchId: "batch-2",
          code: "CB-2",
          claimedByRemovalId: "removal-previous",
          productionRunIds: ["run-2"],
          applicationIds: ["application-1", "application-2"],
          applicationSlices: [
            { applicationId: "application-1" },
            { applicationId: "application-2" },
          ],
        },
      ],
      runs: [run("run-1"), run("run-2")],
      lineages: [
        lineage("application-1", "AP-1"),
        lineage("application-2", "AP-2"),
      ],
      transportLegs: { feedstock: [], biochar: [], sample: [] },
      attributionByRunId: new Map(),
      runSummary: RUN_SUMMARY,
      requiredTransportCategories: ["feedstock", "biochar", "sample"],
    });

    expect(aggregateProductionRuns).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Map),
      { productionRunIds: new Set(["run-1"]) },
    );
    expect(preview.claims.map((claim) => claim.contribution)).toEqual([
      "production-and-delivery",
      "delivery-only",
    ]);
    expect(preview.inputs.map((entry) => entry.id)).toEqual([
      "biochar-dry-mass",
      "feedstock-dry-mass",
      "diesel",
      "grid-electricity",
      "feedstock-transport",
      "biochar-transport",
      "sample-transport",
    ]);
    expect(preview.applications).toEqual([
      expect.objectContaining({
        id: "application-1",
        creditBatchIds: ["batch-1", "batch-2"],
      }),
      expect.objectContaining({
        id: "application-2",
        creditBatchIds: ["batch-2"],
      }),
    ]);
  });

  it("suppresses production inputs for a delivery-only Removal", () => {
    const preview = buildRemovalLedgerPreview({
      removalId: "removal-current",
      memberBatchClaims: [{
        creditBatchId: "batch-1",
        code: "CB-1",
        claimedByRemovalId: "removal-previous",
        productionRunIds: ["run-1"],
        applicationIds: ["application-1"],
      }],
      runs: [run("run-1")],
      lineages: [lineage("application-1", "AP-1")],
      transportLegs: { feedstock: [], biochar: [], sample: [] },
      attributionByRunId: new Map(),
      runSummary: RUN_SUMMARY,
      requiredTransportCategories: ["biochar"],
    });

    expect(preview.inputs.map((entry) => entry.id)).toEqual([
      "biochar-dry-mass",
      "biochar-transport",
    ]);
  });

  it("keeps claims and source records when numeric aggregation fails", () => {
    vi.mocked(aggregateProductionRuns).mockImplementation(() => {
      throw new Error("incomplete source data");
    });

    const preview = buildRemovalLedgerPreview({
      removalId: "removal-1",
      memberBatchClaims: [{
        creditBatchId: "batch-1",
        code: "CB-1",
        claimedByRemovalId: null,
        productionRunIds: ["run-1"],
        applicationIds: ["application-1"],
      }],
      runs: [run("run-1")],
      lineages: [lineage("application-1", "AP-1")],
      transportLegs: { feedstock: [], biochar: [], sample: [] },
      attributionByRunId: new Map(),
      runSummary: RUN_SUMMARY,
      requiredTransportCategories: ["biochar"],
    });

    expect(preview.inputs).toEqual([]);
    expect(preview.inputsUnavailable).toBe(true);
    expect(preview.claims).toHaveLength(1);
    expect(preview.productionRuns).toEqual([{ id: "run-1", code: "RUN-1" }]);
    expect(preview.applications[0]).toEqual(
      expect.objectContaining({ id: "application-1", creditBatchIds: ["batch-1"] }),
    );
  });
});
