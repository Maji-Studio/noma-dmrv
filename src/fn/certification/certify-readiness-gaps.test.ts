import { describe, expect, it } from "vitest";
import type { ProductionRunWithSamples } from "@/lib/isometric/utils/aggregation";
import type { CreditBatchWithSamples } from "@/data-access/credit-batch-samples";
import type { TransportLeg } from "@/db/schema";
import { buildEntityReadinessResult } from "./certify-readiness-gaps";

const TRANSPORT_LEG_ID = "00000000-0000-4000-a000-000000000001";

/** A lab sample whose chemistry is complete for the 200-year tier. */
function labSample(
  id: string,
  sampleCode: string,
  overrides: Record<string, number | null> = {},
) {
  return {
    id,
    sampleCode,
    organicCarbonPercent: 78,
    hToCOrgRatio: 0.32,
    oToCOrgRatio: 0.14,
    ...overrides,
  };
}

function batchWithSamples(
  samples: ReturnType<typeof labSample>[],
): CreditBatchWithSamples {
  return {
    id: "00000000-0000-4000-a000-0000000000b1",
    code: "CB-001",
    durabilityOption: "200_year",
    samples,
  } as unknown as CreditBatchWithSamples;
}

function productionRun(
  id: string,
  code: string,
  electricityKwh: number | null,
): ProductionRunWithSamples {
  return {
    id,
    code,
    status: "complete",
    feedstockWetMassKg: 5_000,
    feedstockMoisturePercent: 25,
    biocharOutputKg: 1_500,
    biocharMoisturePercent: 10,
    dieselOperationLiters: 0,
    dieselGensetLiters: 12,
    preprocessingFuelLiters: 3,
    electricityKwh,
    readingsCount: 1,
    samples: [],
  } as unknown as ProductionRunWithSamples;
}

describe("buildEntityReadinessResult", () => {
  it("lists only production runs that are affected by the issue", () => {
    const result = buildEntityReadinessResult(
      [
        productionRun("run-ready", "PR-READY", 50),
        productionRun("run-affected", "PR-AFFECTED", null),
      ],
      [],
      { feedstock: [], biochar: [], sample: [] },
      [],
    );

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      key: "production-runs",
      fixTarget: "productionRuns",
      affectedRecords: [
        {
          id: "run-affected",
          code: "PR-AFFECTED",
        },
      ],
    });
    expect(result.issues[0]?.affectedRecords[0]?.missing).toContain(
      "Electricity",
    );
    expect(result.gaps.join(" ")).toContain("PR-AFFECTED");
    expect(result.gaps.join(" ")).not.toContain("run-affected");
  });

  it("uses a friendly transport label in blocking gaps", () => {
    const transportLeg = {
      id: TRANSPORT_LEG_ID,
      entityId: "00000000-0000-4000-a000-000000000002",
      distanceKm: 25,
      loadMassKg: 900,
      distanceSource: "manual",
      transportEvidenceDocumentCount: 0,
    } as unknown as TransportLeg;

    const result = buildEntityReadinessResult(
      [],
      [],
      { feedstock: [transportLeg], biochar: [], sample: [] },
      ["feedstock"],
    );

    expect(result.gaps.join(" ")).toContain("feedstock transport 1");
    expect(result.gaps.join(" ")).not.toContain(TRANSPORT_LEG_ID);
    expect(result.issues).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });

  // O:Corg is an UNCONDITIONAL sample descriptor, deliberately symmetric with
  // H:Corg (Soil Module §3.3 Table 2 checks pooled H/C_org AND O/C_org for every
  // tier). Readiness walks every sample of every member batch, so one extra
  // sample without oxygen blocks the batch even when three usable replicates
  // already satisfy the §8.3.1 minimum. That is the intended fail-closed
  // behaviour on a registry path, not an accident — this test pins it.
  it("blocks a batch that already has three usable replicates when an extra sample is missing O:Corg", () => {
    const result = buildEntityReadinessResult(
      [],
      [
        batchWithSamples([
          labSample("sample-1", "S-001"),
          labSample("sample-2", "S-002"),
          labSample("sample-3", "S-003"),
          labSample("sample-4", "S-004", { oToCOrgRatio: null }),
          labSample("sample-5", "S-005", { oToCOrgRatio: null }),
        ]),
      ],
      { feedstock: [], biochar: [], sample: [] },
      [],
    );

    expect(result.gaps).toEqual([
      "Sample S-004: O:Corg ratio",
      "Sample S-005: O:Corg ratio",
    ]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      key: "lab-samples",
      fixTarget: "labSamples",
      affectedRecords: [
        { id: "sample-4", code: "S-004", missing: ["O:Corg ratio"] },
        { id: "sample-5", code: "S-005", missing: ["O:Corg ratio"] },
      ],
    });
  });

  it("keeps feedstock and biochar evidence blockers separately identified", () => {
    const feedstockLeg = {
      id: "00000000-0000-4000-a000-000000000003",
      entityId: "00000000-0000-4000-a000-000000000004",
      distanceKm: 25,
      loadMassKg: 900,
      distanceSource: "manual",
      transportEvidenceDocumentCount: 0,
    } as unknown as TransportLeg;
    const biocharLeg = {
      id: "00000000-0000-4000-a000-000000000005",
      entityId: "00000000-0000-4000-a000-000000000006",
      distanceKm: 30,
      loadMassKg: 700,
      distanceSource: "manual",
      transportEvidenceDocumentCount: 0,
    } as unknown as TransportLeg;

    const result = buildEntityReadinessResult(
      [],
      [],
      { feedstock: [feedstockLeg], biochar: [biocharLeg], sample: [] },
      ["feedstock", "biochar"],
    );

    expect(result.gaps).toHaveLength(2);
    expect(result.gaps[0]).toContain("feedstock transport 1");
    expect(result.gaps[1]).toContain("biochar transport 1");
    expect(result.issues).toHaveLength(2);
    expect(result.warnings).toEqual([]);
  });
});
