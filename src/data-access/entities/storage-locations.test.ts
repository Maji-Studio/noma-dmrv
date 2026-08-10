import { describe, expect, it } from "vitest";
import type { LaneStockDerivation } from "../lane-stock-derivation";
import {
  formatStorageLocationSubtitle,
  toStorageLocationEntityOption,
} from "./storage-locations";

type StorageLocationOptionRow = Parameters<
  typeof toStorageLocationEntityOption
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
    totalStoredKg: 0,
    totalStoredWetKg: 0,
    pendingStoredKg: 0,
    totalConsumedKg: 0,
    totalProducedWetKg: 0,
    totalProducedDryKg: 0,
    unresolvedProducedDryCount: 0,
    totalAllocatedWetKg: 0,
    totalAllocatedDryKg: 0,
    documentedLossWetKg: 0,
    totalProductKg: 0,
    totalProductDryKg: 0,
    unresolvedProductDryCount: 0,
    totalDeliveredWetKg: 0,
    totalDeliveredDryKg: 0,
    unresolvedDeliveredDryCount: 0,
    biocharEquivalentKg: 0,
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
    biocharProducedKg: 0,
    biocharAllocatedKg: 0,
    biocharMovementDeltaKg: 0,
    biocharStockKg: 0,
    productMovementDeltaKg: 0,
    ...overrides,
  };
}

describe("formatStorageLocationSubtitle", () => {
  it("labels available biochar with explicit wet and dry figures", () => {
    expect(
      formatStorageLocationSubtitle(
        "biochar_bin",
        null,
        null,
        0,
        0,
        0,
        3_500,
        3_430,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        null,
      ),
    ).toBe(
      "Biochar bin · Wet biochar: 3,500kg | Dry biochar: 3,430kg available",
    );
  });

  it("labels product-bin inventory with explicit wet and dry figures", () => {
    expect(
      formatStorageLocationSubtitle(
        "product_bin",
        null,
        null,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        3_500,
        3_325,
        0,
        3_500,
        null,
      ),
    ).toBe(
      "Product bin · Pure biochar · Wet biochar product: 3,500kg | Dry biochar: 3,325kg stored · 3,500 kg biochar equivalent",
    );
  });
});

describe("toStorageLocationEntityOption", () => {
  it("uses wet stock as authoritative and exposes dry only as an estimate", () => {
    const option = toStorageLocationEntityOption(
      storageRow({
        type: "feedstock_bin",
        totalStoredKg: 2_800,
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

  it("uses authoritative biochar lane stock and records dry stock", () => {
    const option = toStorageLocationEntityOption(
      storageRow({
        type: "biochar_bin",
        totalProducedWetKg: 3_500,
        totalProducedDryKg: 3_300,
        totalAllocatedWetKg: 500,
        totalAllocatedDryKg: 400,
      }),
      laneStock({
        biocharProducedKg: 3_500,
        biocharAllocatedKg: 500,
        biocharStockKg: 3_000,
      }),
    );

    expect(option.remainingMass).toEqual({ wetKg: 3_000, dryKg: 2_900 });
  });

  it("includes biochar reconciliation stock without inventing its dry basis", () => {
    const option = toStorageLocationEntityOption(
      storageRow({
        type: "biochar_bin",
        totalProducedWetKg: 3_000,
        totalProducedDryKg: 2_900,
      }),
      laneStock({
        biocharProducedKg: 3_000,
        biocharMovementDeltaKg: 100,
        biocharStockKg: 3_100,
      }),
    );

    expect(option.remainingMass).toEqual({ wetKg: 3_100, dryKg: null });
    expect(option.subtitle).toContain(
      "Wet biochar: 3,100kg | Dry biochar: Not recorded available",
    );
  });

  it("subtracts deliveries from product-bin wet and dry stock", () => {
    const option = toStorageLocationEntityOption(
      storageRow({
        type: "product_bin",
        totalProductKg: 3_500,
        totalProductDryKg: 3_400,
        totalDeliveredWetKg: 500,
        totalDeliveredDryKg: 500,
      }),
      laneStock({}),
    );

    expect(option.remainingMass).toEqual({ wetKg: 3_000, dryKg: 2_900 });
  });

  it("does not invent dry stock after an unbased reconciliation movement", () => {
    const option = toStorageLocationEntityOption(
      storageRow({
        type: "product_bin",
        totalProductKg: 3_000,
        totalProductDryKg: 2_900,
      }),
      laneStock({ productMovementDeltaKg: -100 }),
    );

    expect(option.remainingMass).toEqual({ wetKg: 2_900, dryKg: null });
    expect(option.subtitle).toContain(
      "Wet biochar product: 2,900kg | Dry biochar: Not recorded stored",
    );
  });
});
