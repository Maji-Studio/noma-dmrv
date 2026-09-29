import { describe, expect, it } from "vitest";
import type { LaneStockDerivation } from "../lane-stock-derivation";
import { toFeedstockBinEntityOption } from "./storage-locations";

type StorageLocationOptionRow = Parameters<
  typeof toFeedstockBinEntityOption
>[0];

function storageRow(
  overrides: Partial<StorageLocationOptionRow>,
): StorageLocationOptionRow {
  return {
    id: "bin-1",
    code: "BIN-01",
    name: "North bin",
    type: "feedstock_bin",
    heldFeedstockTypeName: null,
    heldFeedstockTypeUsage: null,
    feedstockTypeName: null,
    totalStoredWetKg: 0,
    pendingStoredWetKg: 0,
    totalConsumedKg: 0,
    ...overrides,
  };
}

function laneStock(
  overrides: Partial<LaneStockDerivation>,
): LaneStockDerivation {
  return {
    storageLocationId: "bin-1",
    feedstockIntakeDryKg: 0,
    feedstockIntakeWetKg: 0,
    feedstockConsumedWetKg: 0,
    feedstockMovementDeltaKg: 0,
    feedstockStockWetKg: 0,
    feedstockEstimatedDryKg: 0,
    biocharAllocatedKg: 0,
    ...overrides,
  };
}

describe("toFeedstockBinEntityOption", () => {
  it("uses wet stock as authoritative and exposes dry only as an estimate", () => {
    const option = toFeedstockBinEntityOption(
      storageRow({
        type: "feedstock_bin",
        totalStoredWetKg: 3_500,
      }),
      laneStock({
        feedstockIntakeDryKg: 1_950,
        feedstockIntakeWetKg: 3_000,
        feedstockStockWetKg: 3_000,
        feedstockEstimatedDryKg: 1_950,
      }),
    );

    expect(option.remainingMass).toEqual({ wetKg: 3_000, dryKg: 1_950 });
    expect(option.subtitle).toContain("3,000 kg stored");
  });
});
