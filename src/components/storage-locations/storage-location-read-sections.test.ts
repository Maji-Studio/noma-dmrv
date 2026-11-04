import { expect, it, vi } from "vitest";
import type { StorageLocationWithFacility } from "@/data-access/storage-locations";
import { storageLocationSheetSections } from "./storage-location-read-sections";

const productBin = {
  id: "bin", facilityId: "facility", type: "product_bin", stockMode: "split", drawOrder: "oldest_first", name: "Product store",
  capacityKg: null, storageMethod: null, storageDescription: null, formulationName: "Mix", archivedAt: null,
  productInventory: { batchCount: 2, biocharEquivalentKg: 1440, formulationNames: ["Mix"], appliedApplicationCount: 1, appliedDryMassKg: 200, lastAppliedAt: new Date("2026-09-01") },
} as unknown as StorageLocationWithFacility;

it("says the product bin's lifetime biochar is dry, as the applied mass beside it does", () => {
  const inventory = storageLocationSheetSections(productBin, vi.fn()).find(section => section.title === "Inventory");
  const labels = inventory?.fields?.map(field => field.label);
  expect(labels).toContain("Biochar received, dry, all time");
  expect(labels).toContain("Applied, dry");
  expect(labels).not.toContain("Biochar received, all time");
});

it("lists a feedstock bin's draw method as two rows for In order, one for Mass weighted, with no output-bin stock mode rows", () => {
  const feedstockBin = { ...productBin, type: "feedstock_bin", stockMode: "mix", feedstockTypeName: "Maize cobs", feedstockInventory: { currentWetMassKg: 900, pendingWetMassKg: 0, pendingBatchCount: 0, estimatedDryMassKg: 700, estimatedMoisturePercent: 22, feedstockTypes: ["Maize cobs"] } } as unknown as StorageLocationWithFacility;
  const labels = (bin: StorageLocationWithFacility) => storageLocationSheetSections(bin, vi.fn()).flatMap(section => section.fields ?? []);
  expect(labels(feedstockBin).find(field => field.label === "Draw method")?.value).toBe("Mass weighted");
  const newest = { ...feedstockBin, stockMode: "split", drawOrder: "newest_first" } as unknown as StorageLocationWithFacility;
  expect(labels(newest).find(field => field.label === "Draw method")?.value).toBe("In order");
  expect(labels(newest).find(field => field.label === "Draw order")?.value).toBe("Newest first");
  expect(labels(feedstockBin).map(field => field.label)).not.toContain("Draw order");
  expect(labels(newest).map(field => field.label)).not.toContain("Stock mode");
  expect(labels(productBin).map(field => field.label)).not.toContain("Draw method");
});
