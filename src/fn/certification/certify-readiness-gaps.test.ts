import { describe, expect, it } from "vitest";
import type { ProductionRunWithSamples } from "@/lib/isometric/utils/aggregation";
import type { TransportLeg } from "@/db/schema";
import { buildEntityReadinessResult } from "./certify-readiness-gaps";

const TRANSPORT_LEG_ID = "00000000-0000-4000-a000-000000000001";

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

  it("uses a friendly transport label in flat readiness gaps", () => {
    const transportLeg = {
      id: TRANSPORT_LEG_ID,
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
    expect(result.issues[0]?.affectedRecords[0]).toMatchObject({
      id: TRANSPORT_LEG_ID,
      code: "feedstock transport 1",
    });
  });
});
