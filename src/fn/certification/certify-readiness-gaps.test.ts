import { describe, expect, it } from "vitest";
import type { ProductionRunForCertification } from "@/lib/isometric/utils/aggregation";
import type { CreditBatchWithSamples } from "@/data-access/credit-batch-samples";
import type { TransportLeg } from "@/db/schema";
import { deriveEntityCertifyReadiness } from "@/lib/certification/entity-readiness";
import { buildEntityReadinessResult } from "./certify-readiness-gaps";

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
    moistureContentPercent: 10,
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
    sampling: "sampled",
    durabilityOption: "200_year",
    samples,
  } as unknown as CreditBatchWithSamples;
}

function productionRun(
  id: string,
  code: string,
  electricityKwh: number | null,
): ProductionRunForCertification {
  return {
    id,
    code,
    status: "complete",
    hasReadingsFile: true,
    feedstockWetMassKg: 5_000,
    feedstockMoisturePercent: 25,
    biocharOutputKg: 1_500,
    biocharMoisturePercent: 10,
    dieselOperationLiters: 0,
    dieselGensetLiters: 12,
    preprocessingFuelLiters: 3,
    electricityKwh,
    samples: [],
  } as unknown as ProductionRunForCertification;
}

describe("buildEntityReadinessResult", () => {
  it("reports moisture on the same Sample walk used by submission and keeps documents advisory", () => {
    const batch = { ...batchWithSamples([labSample("s1", "S-001", { moistureContentPercent: null })]), creditBatchCode: "CB-001", hasLabReport: false };
    const result = buildEntityReadinessResult([], [batch], { feedstock: [], biochar: [], sample: [] }, []);
    expect(result.gaps).toEqual(["Sample S-001: Sample moisture"]);
    expect(result.warnings).toEqual(["Credit batch CB-001 has no lab report document. Upload a lab report to one of its Samples. You can still submit the Removal."]);
  });

  it("keeps the ready-batch fixture ready when Application evidence is absent", () => {
    const fixtureRun = productionRun("fixture-run", "PR-FIXTURE", 50);

    expect(
      deriveEntityCertifyReadiness("application", {
        biocharAppliedTons: 0.1,
        biocharAppliedDryTons: 0.098,
        durabilityOption: "200_year",
        soilTemperatureC: 25,
      }),
    ).toMatchObject({ state: "ready", gaps: [] });

    expect(
      buildEntityReadinessResult(
        [fixtureRun],
        [],
        { feedstock: [], biochar: [], sample: [] },
        [],
      ).gaps,
    ).toEqual([]);
  });

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

  it("blocks Removal preflight when a completed run lacks readings evidence", () => {
    const run = {
      ...productionRun("run-missing-csv", "PR-NO-CSV", 50),
      hasReadingsFile: false,
    };

    const result = buildEntityReadinessResult(
      [run],
      [],
      { feedstock: [], biochar: [], sample: [] },
      [],
    );

    expect(result.gaps).toEqual([
      "Production run PR-NO-CSV: Readings CSV file",
    ]);
    expect(result.issues).toMatchObject([
      {
        key: "production-runs",
        affectedRecords: [
          {
            id: "run-missing-csv",
            code: "PR-NO-CSV",
            missing: ["Readings CSV file"],
          },
        ],
      },
    ]);
  });

  it("does not block a required transport category without evidence", () => {
    const transportLeg = {
      id: "00000000-0000-4000-a000-000000000001",
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

    expect(result.gaps).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  // Soil Module §3.3 Table 2 checks pooled H/C_org AND O/C_org on every tier
  // (QA 2026-07-25 F-6). On sampled batches, an extra Sample without oxygen
  // blocks even when three usable replicates satisfy the §8.3.1 minimum.
  // Scope matches durability-submission-gates.ts, which skips unsampled batches.
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

  it("does not create evidence blockers for feedstock or biochar legs", () => {
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

    expect(result.gaps).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(result.warnings).toEqual([]);
  });
});

it("keeps missing histogram evidence advisory for sampled 1,000-year batches", () => {
  const batch = { ...batchWithSamples([]), creditBatchCode: "CB-001", durabilityOption: "1000_year" as const, hasReflectanceHistogram: false };
  const result = buildEntityReadinessResult([], [batch], { feedstock: [], biochar: [], sample: [] }, []);
  expect(result.gaps).toEqual([]);
  expect(result.warnings).toEqual(["Credit batch CB-001 has no reflectance histogram document. Upload a reflectance histogram to one of its Samples. You can still submit the Removal."]);
});
