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
