/**
 * Pins the two board decisions that are easy to "correct" back into bugs:
 * what a bin tile calls the material it holds, and the fact that every sort
 * option maps to a key the server can actually order by.
 */
import { describe, expect, it } from "vitest";
import type { StorageLocationWithFacility } from "@/data-access/storage-locations";
import type { StorageLocationType } from "@/schemas/storage-locations";
import { storageLocationSortKeys } from "@/schemas/storage-locations";
import {
  BIN_SORT_OPTIONS,
  BIN_TYPE_FILTER_ORDER,
  DEFAULT_BIN_SORT,
  binMaterialName,
  parseBinSortValue,
} from "./bin-display";

function makeBin(
  type: StorageLocationType,
  overrides: Partial<StorageLocationWithFacility> = {},
): StorageLocationWithFacility {
  return {
    id: "bin-1",
    organizationId: "org-1",
    code: "FB-001",
    name: "North hopper",
    type,
    capacityKg: null,
    storageMethod: null,
    storageDescription: null,
    supplierReferenceId: null,
    feedstockTypeId: null,
    formulationId: null,
    facilityId: "facility-1",
    archivedAt: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    facilityCode: "FAC-1",
    facilityName: "Moshi",
    feedstockTypeName: null,
    formulationName: null,
    feedstockInventory: {
      batchCount: 0,
      pendingBatchCount: 0,
      feedstockTypes: [],
      currentWetMassKg: 0,
      estimatedDryMassKg: null,
      pendingDryMassKg: 0,
      estimatedMoisturePercent: null,
    },
    biocharInventory: {
      productionRunCount: 0,
      currentMassKg: 0,
      allocatedToProductsKg: 0,
      downstreamFormulations: [],
    },
    productInventory: {
      batchCount: 0,
      currentMassKg: 0,
      biocharEquivalentKg: 0,
      formulationNames: [],
      appliedApplicationCount: 0,
      appliedDryMassKg: 0,
      lastAppliedAt: null,
    },
    lastActivity: null,
    ...overrides,
  } as StorageLocationWithFacility;
}

describe("binMaterialName", () => {
  it("prefers the bin's assigned feedstock type over what it happens to hold", () => {
    const bin = makeBin("feedstock_bin", {
      feedstockTypeName: "Hardwood chips",
      feedstockInventory: {
        ...makeBin("feedstock_bin").feedstockInventory,
        feedstockTypes: ["Softwood chips"],
      },
    });

    expect(binMaterialName(bin)).toBe("Hardwood chips");
  });

  it("falls back to what an unassigned feedstock bin holds", () => {
    const bin = makeBin("feedstock_bin", {
      feedstockInventory: {
        ...makeBin("feedstock_bin").feedstockInventory,
        feedstockTypes: ["Compost"],
      },
    });

    expect(binMaterialName(bin)).toBe("Compost");
  });

  it("names a product bin with no formulation 'Pure biochar', not a blank", () => {
    // A product bin without a formulation is not missing data: it is the bin
    // that accepts pure biochar, and the first formulated product stored in it
    // claims it (data-access/biochar-products.ts). Reporting it as unassigned
    // would read as a fault on a bin that is working exactly as designed.
    expect(binMaterialName(makeBin("product_bin"))).toBe("Pure biochar");
  });

  it("names a claimed product bin by its formulation", () => {
    const bin = makeBin("product_bin", { formulationName: "Garden Blend 40" });
    expect(binMaterialName(bin)).toBe("Garden Blend 40");
  });

  it("never borrows a downstream formulation for a biochar bin", () => {
    // `downstreamFormulations` names the products drawn OUT of the bin, not the
    // biochar sitting in it — printing one would mislabel the contents.
    const bin = makeBin("biochar_bin", {
      biocharInventory: {
        ...makeBin("biochar_bin").biocharInventory,
        downstreamFormulations: ["Garden Blend 40"],
      },
    });

    expect(binMaterialName(bin)).toBe("Biochar");
  });
});

describe("bin sort options", () => {
  it("only offers keys the server can order by", () => {
    // A label whose key the filter schema rejects would silently fall back to
    // the default order, so the board would claim a sort it is not applying.
    for (const option of BIN_SORT_OPTIONS) {
      expect(storageLocationSortKeys).toContain(option.sortBy);
    }
  });

  it("round-trips every option through its wire value", () => {
    for (const option of BIN_SORT_OPTIONS) {
      expect(parseBinSortValue(option.value)).toEqual(option);
    }
  });

  it("falls back to the default for an unknown value", () => {
    expect(parseBinSortValue("onHandKg:desc")).toEqual(DEFAULT_BIN_SORT);
  });
});

describe("bin type filter order", () => {
  it("leads with the unfiltered board, then follows the material flow", () => {
    expect(BIN_TYPE_FILTER_ORDER).toEqual([
      "all",
      "feedstock_bin",
      "biochar_bin",
      "product_bin",
    ]);
  });
});
