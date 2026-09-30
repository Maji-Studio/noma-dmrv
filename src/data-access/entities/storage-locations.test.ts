import { describe, expect, it } from "vitest";
import type { LaneStockDerivation } from "../lane-stock-derivation";
import { toFeedstockBinEntityOption, toOutputBinEntityOption } from "./storage-locations";

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
    formulationName: null,
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

    expect(option.remainingMass).toEqual({ wetKg: 3_000, dryKg: 1_950, dryLabel: "dry feedstock" });
    expect(option.subtitle).toContain("3,000 kg stored");
  });
});

describe("toOutputBinEntityOption", () => {
  const stock = { estimatedWetMassKg: 277, dryMassKg: 249.6 };

  it("leads a product bin subtitle with its formulation", () => {
    const option = toOutputBinEntityOption(storageRow({ type: "product_bin", formulationName: "BCF-01 Organic" }), stock);
    expect(option.subtitle).toMatch(/^BCF-01 Organic · /);
  });

  it("names a product bin with no formulation 'Pure biochar'", () => {
    const option = toOutputBinEntityOption(storageRow({ type: "product_bin" }), stock);
    expect(option.subtitle).toMatch(/^Pure biochar · /);
  });

  it("keeps a biochar bin subtitle to its stock", () => {
    const option = toOutputBinEntityOption(storageRow({ type: "biochar_bin" }), stock);
    expect(option.subtitle).not.toContain(" · ");
  });
});
