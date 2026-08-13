import { describe, expect, it } from "vitest";
import type { Sample } from "@/db/schema";
import {
  LEGACY_1000_YEAR_SEMANTICS_LABEL,
  buildThousandYearDurabilityLedgerModel,
} from "./durability-1000-build-model";
import {
  CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR,
  DEPRECATED_SEQUESTRATION_BLUEPRINT_1000_YEAR,
} from "@/lib/isometric/transformers/measurement-sample";

const sample = (
  id: string,
  totalCarbonPercent: number,
  inorganicCarbonPercent: number | null,
  sReflectanceFraction: number,
) =>
  ({
    id,
    sampleCode: `S-${id}`,
    samplingTime: new Date("2026-07-27T00:00:00.000Z"),
    labName: "Test lab",
    totalCarbonPercent,
    inorganicCarbonPercent,
    sReflectanceFraction,
  }) as unknown as Sample;

describe("buildThousandYearDurabilityLedgerModel", () => {
  it("reconciles the exact ordered replicate lists and attributed product mass", () => {
    const model = buildThousandYearDurabilityLedgerModel({
      batches: [
        {
          creditBatchId: "batch-1",
          creditBatchCode: "CB-26-001",
          facilityTimezone: "UTC",
          runs: [{ id: "run-1", biocharDryMassKg: 800 }],
          samples: [
            sample("c", 79, 1, 1),
            sample("a", 80, 1.5, 1),
            sample("b", 80, 2, 1),
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
        totalCarbonFraction: 0.8,
        inorganicCarbonFraction: 0.015,
        calculatedOrganicCarbonFraction: 0.785,
        sFraction: 1,
      }),
      expect.objectContaining({
        sampleCode: "S-b",
        totalCarbonFraction: 0.8,
        inorganicCarbonFraction: 0.02,
        calculatedOrganicCarbonFraction: 0.78,
        sFraction: 1,
      }),
      expect.objectContaining({
        sampleCode: "S-c",
        totalCarbonFraction: 0.79,
        inorganicCarbonFraction: 0.01,
        calculatedOrganicCarbonFraction: 0.78,
        sFraction: 1,
      }),
    ]);
    expect(model.batches[0]).toMatchObject({
      componentKey: CURRENT_SEQUESTRATION_BLUEPRINT_1000_YEAR,
      rawDurability: expect.any(Number),
      cappedDurability: 0.95,
      capApplied: true,
    });
    expect(model.totalReplicates).toBe(3);
  });

  it("does not derive missing inorganic carbon on the current path", () => {
    const model = buildThousandYearDurabilityLedgerModel({
      batches: [
        {
          creditBatchId: "batch-1",
          creditBatchCode: "CB-1",
          runs: [{ id: "run-1", biocharDryMassKg: 100 }],
          samples: [
            {
              id: "sample-1",
              sampleCode: "S-1",
              totalCarbonPercent: 80,
              organicCarbonPercent: 79,
              inorganicCarbonPercent: null,
              sReflectanceFraction: 0.9,
            } as unknown as Sample,
          ],
        },
      ],
      attributionByRunId: new Map([["run-1", 1]]),
      memberBatchCodes: "CB-1",
      facilityName: null,
      externalProjectId: null,
      generatedAtIso: "2026-08-13T00:00:00.000Z",
    });

    expect(model.batches).toEqual([]);
  });

  it("keeps deprecated evidence readable with explicit total-carbon uncapped semantics", () => {
    const model = buildThousandYearDurabilityLedgerModel({
      componentKey: DEPRECATED_SEQUESTRATION_BLUEPRINT_1000_YEAR,
      batches: [
        {
          creditBatchId: "legacy-batch",
          creditBatchCode: "CB-LEGACY",
          runs: [{ id: "run-1", biocharDryMassKg: 100 }],
          samples: [
            sample("a", 80, null, 1),
            sample("b", 81, null, 1),
            sample("c", 82, null, 1),
          ],
        },
      ],
      attributionByRunId: new Map([["run-1", 1]]),
      memberBatchCodes: "CB-LEGACY",
      facilityName: null,
      externalProjectId: null,
      generatedAtIso: "2026-08-13T00:00:00.000Z",
    });

    expect(model.batches[0]).toMatchObject({
      componentKey: DEPRECATED_SEQUESTRATION_BLUEPRINT_1000_YEAR,
      semanticsLabel: LEGACY_1000_YEAR_SEMANTICS_LABEL,
      rawDurability: 1,
      cappedDurability: 1,
      capApplied: false,
    });
    expect(model.batches[0].replicates[0]).toMatchObject({
      inorganicCarbonFraction: null,
      calculatedOrganicCarbonFraction: null,
    });
  });
});
