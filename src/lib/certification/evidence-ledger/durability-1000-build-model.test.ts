import { describe, expect, it } from "vitest";
import type { Sample } from "@/db/schema";
import { buildThousandYearDurabilityLedgerModel } from "./durability-1000-build-model";

describe("buildThousandYearDurabilityLedgerModel", () => {
  it("reconciles the exact ordered replicate lists and attributed product mass", () => {
    const sample = (
      id: string,
      totalCarbonPercent: number,
      sReflectanceFraction: number,
    ) =>
      ({
        id,
        sampleCode: `S-${id}`,
        samplingTime: new Date("2026-07-27T00:00:00.000Z"),
        labName: "Test lab",
        totalCarbonPercent,
        sReflectanceFraction,
      }) as unknown as Sample;

    const model = buildThousandYearDurabilityLedgerModel({
      batches: [
        {
          creditBatchId: "batch-1",
          creditBatchCode: "CB-26-001",
          facilityTimezone: "UTC",
          runs: [{ id: "run-1", biocharDryMassKg: 800 }],
          samples: [
            sample("c", 79, 0.91),
            sample("a", 80, 0.98),
            sample("b", 80, 0.97),
          ],
        },
      ],
      attributionByRunId: new Map([["run-1", 0.5]]),
      memberBatchCodes: "CB-26-001",
      facilityName: "Test facility",
      externalProjectId: "prj-test",
      generatedAtIso: "2026-07-28T00:00:00.000Z",
    });

    expect(model.batches).toHaveLength(1);
    expect(model.batches[0].productMassKg).toBe(400);
    expect(model.batches[0].replicates).toEqual([
      expect.objectContaining({
        sampleCode: "S-a",
        carbonContentFraction: 0.8,
        sFraction: 0.98,
      }),
      expect.objectContaining({
        sampleCode: "S-b",
        carbonContentFraction: 0.8,
        sFraction: 0.97,
      }),
      expect.objectContaining({
        sampleCode: "S-c",
        carbonContentFraction: 0.79,
        sFraction: 0.91,
      }),
    ]);
    expect(model.totalReplicates).toBe(3);
  });
});
