import { describe, expect, it } from "vitest";
import { attributeSoilTemperatureBlockers } from "./member-batch-gates";

describe("attributeSoilTemperatureBlockers", () => {
  it("adds removal-level soil blockers only to affected 200-year batches", () => {
    const soilBlocker = "Set the facility reference soil temperature.";

    expect(
      attributeSoilTemperatureBlockers(
        [
          {
            id: "batch-200",
            durabilityGateBlockers: ["Existing durability blocker"],
          },
          { id: "batch-1000", durabilityGateBlockers: [] },
        ],
        [
          { creditBatchId: "batch-200", durabilityOption: "200_year" },
          { creditBatchId: "batch-1000", durabilityOption: "1000_year" },
        ],
        [soilBlocker],
      ),
    ).toEqual([
      {
        id: "batch-200",
        durabilityGateBlockers: ["Existing durability blocker"],
        facilityEmissionsGateBlockers: [soilBlocker],
        facilityEmissionsGateFacts: ["This facility has no reference soil temperature."],
      },
      {
        id: "batch-1000",
        durabilityGateBlockers: [],
        facilityEmissionsGateBlockers: [],
        facilityEmissionsGateFacts: [],
      },
    ]);
  });
});
