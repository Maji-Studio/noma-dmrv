import { beforeAll, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { feedstocks, supplierLocations } from "@/db/schema";
import { getFeedstockById, updateFeedstockInTransaction } from "@/data-access/feedstocks";
import { createSupplierLocation, updateSupplierLocation } from "@/data-access/suppliers";
import * as transport from "@/data-access/transport-legs";
import { withLineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext, TEST_SITE_POSITION } from "./helpers/test-org";
import { ensureOutputFixtureActor } from "./helpers/output-contract-fixtures";

const ctx = makeTestOrgContext();
beforeAll(async () => { await ensureTestOrg(); await ensureOutputFixtureActor(ctx); });

it.each([null, 0])("persists an override, keeps it after a failed sync, and clears with %s to the current pair", async clearDistance => {
  await withLineageFixture(async fixture => {
    const original = await getFeedstockById(ctx, fixture.feedstockId);
    const location = await createSupplierLocation(ctx, {
      ...TEST_SITE_POSITION, supplierId: original.supplierId, isDefault: true,
      facilityDistances: [{ facilityId: fixture.facilityId, distanceKm: 42, distanceSource: "map_estimate" }],
    });
    try {
      const saved = await db.transaction(tx => updateFeedstockInTransaction(ctx, tx, original.id, {
        expectedVersion: original.version, transportDistanceKm: 25,
        transportDistanceSource: "document", distanceNote: "Measured route",
      }));
      expect(saved).toMatchObject({ distanceKmOverride: 25, distanceSource: "document", distanceNote: "Measured route" });
      const sync = vi.spyOn(transport, "syncFeedstockTransportLeg").mockRejectedValueOnce(new Error("Sync unavailable"));
      try {
        await expect(db.transaction(tx => updateFeedstockInTransaction(ctx, tx, original.id, {
          expectedVersion: saved.version, transportDistanceKm: 88, notes: "Unrelated edit",
        }))).rejects.toThrow("Sync unavailable");
      } finally { sync.mockRestore(); }
      expect(await getFeedstockById(ctx, original.id)).toMatchObject({ distanceKmOverride: 25, version: saved.version });
      const changedLocation = await updateSupplierLocation(ctx, location.id, { expectedVersion: location.version,
        facilityDistances: [{ facilityId: fixture.facilityId, distanceKm: 55, distanceSource: "manual" }],
      });
      expect((await getFeedstockById(ctx, original.id)).transportDistanceKm).toBe(25);
      const cleared = await db.transaction(tx => updateFeedstockInTransaction(ctx, tx, original.id, {
        expectedVersion: saved.version, transportDistanceKm: clearDistance,
      }));
      expect(cleared).toMatchObject({ distanceKmOverride: null, distanceSource: null, transportDistanceKm: 55, transportDistanceSource: "manual" });
      await updateSupplierLocation(ctx, location.id, { expectedVersion: changedLocation.version,
        facilityDistances: [{ facilityId: fixture.facilityId, distanceKm: 70, distanceSource: "document" }],
      });
      const unchanged = await db.transaction(tx => updateFeedstockInTransaction(ctx, tx, original.id, {
        expectedVersion: cleared.version, notes: "Unrelated edit",
      }));
      expect(unchanged.transportDistanceKm).toBe(55);
      const [stored] = await db.select().from(feedstocks).where(eq(feedstocks.id, original.id));
      expect(stored.distanceKmOverride).toBeNull();
    } finally { await db.delete(supplierLocations).where(eq(supplierLocations.id, location.id)); }
  }, "none");
});
