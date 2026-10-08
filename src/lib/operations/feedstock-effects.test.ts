import { expect, it, vi } from "vitest";
vi.mock("@/data-access/feedstocks", () => ({
  createFeedstockInTransaction: vi.fn(), updateFeedstockInTransaction: vi.fn(), deleteFeedstockInTransaction: vi.fn(),
}));
vi.mock("@/data-access/storage-object-deletions", () => ({ processPendingStorageObjectDeletions: vi.fn() }));
import { logFeedstockDelivery, updateFeedstock, deleteFeedstock } from "./feedstocks";
import type { CreateFeedstockResult, FeedstockWithRelations } from "@/data-access/feedstocks";

const id = "00000000-0000-4000-8000-000000000001";
it("describes all created allocation IDs using returned versions and only decoded field names", () => {
  const input = logFeedstockDelivery.input.parse({
    facilityId: id, supplierId: id, feedstockTypeId: id, deliveryDate: "2026-10-06",
    totalWetMassKg: "4200", moisturePercent: "32.5", transportDistanceKm: 18,
    allocations: [{ storageLocationId: id, allocatedWetMassKg: 4200 }], notes: "private note",
    unrecognized: "discarded",
  });
  const effect = logFeedstockDelivery.describe!(input, {
    feedstocks: [{ id: "first", version: 1 }, { id: "second", version: 1 }], warning: null,
  } as CreateFeedstockResult);
  expect(effect).toEqual({
    outcome: "created", entityType: "feedstock", entityIds: ["first", "second"],
    versionBefore: null, versionAfter: 1,
    changedFields: ["allocations", "deliveryDate", "facilityId", "feedstockTypeId", "moisturePercent", "notes", "supplierId", "totalWetMassKg", "transportDistanceKm"],
  });
  expect(JSON.stringify(effect)).not.toContain("private note");
});
it("includes explicit clears but excludes omitted fields and the target id in updates", () => {
  const input = updateFeedstock.input.parse({ feedstockId: id, expectedVersion: 4, supplierId: id, notes: null });
  expect(updateFeedstock.describe!(input, { id, version: 5 } as FeedstockWithRelations)).toEqual({
    outcome: "updated", entityType: "feedstock", entityIds: [id], versionBefore: 4, versionAfter: 5, changedFields: ["notes", "supplierId"],
  });
});
it("describes a void delete from its decoded input", () => {
  expect(deleteFeedstock.describe!({ feedstockId: id, expectedVersion: 5 }, undefined)).toEqual({
    outcome: "deleted", entityType: "feedstock", entityIds: [id], versionBefore: 5, versionAfter: null, changedFields: [],
  });
});
