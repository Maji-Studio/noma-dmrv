import { beforeAll, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { certificationSubmissions, feedstocks, productionRunFeedstocks, productionRuns, transportLegs } from "@/db/schema";
import { createTransportLeg, deleteTransportLeg, updateTransportLeg } from "@/data-access/transport-legs";
import { updateFeedstockInTransaction } from "@/data-access/feedstocks";
import { getRecordLocks } from "@/data-access/certification-lineage-guards";
import { getTransportDistanceDrift } from "@/data-access/transport-distance-drift";
import { withLineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

beforeAll(() => ensureTestOrg());

it.each(["sent", "reserved"] as const)("locks only owned feedstock transport for a %s Removal, but locks every linked record's mass", async state => {
  const ctx = makeTestOrgContext();
  await withLineageFixture(async earlier => {
    await db.update(productionRuns).set({ status: "complete", startTime: new Date("2026-06-12T08:00:00Z"), endTime: new Date("2026-06-12T12:00:00Z") })
      .where(and(eq(productionRuns.organizationId, TEST_ORG_ID), eq(productionRuns.id, earlier.productionRunId)));
    await withLineageFixture(async later => {
      await db.insert(productionRunFeedstocks).values({ organizationId: TEST_ORG_ID,
        productionRunId: later.productionRunId, feedstockId: earlier.feedstockId, wetMassUsedKg: 1 });
      if (state === "reserved") {
        await db.update(certificationSubmissions).set({ status: "draft", externalId: null, submittedAt: null, lockedAt: new Date() })
          .where(and(eq(certificationSubmissions.organizationId, TEST_ORG_ID), eq(certificationSubmissions.localEntityId, later.removalId)));
      }
      const legInput = { entityType: "feedstock" as const, entityId: earlier.feedstockId,
        distanceKm: 10, loadMassKg: 1000, transportMethodType: "road" as const };
      const leg = await createTransportLeg(ctx, legInput);
      const updated = await updateTransportLeg(ctx, leg.id, { expectedVersion: leg.version, distanceKm: 20 });
      expect(updated.distanceKm).toBe(20);
      await deleteTransportLeg(ctx, updated.id, updated.version);
      expect(await db.select().from(transportLegs).where(and(eq(transportLegs.organizationId, TEST_ORG_ID), eq(transportLegs.id, leg.id)))).toEqual([]);

      const ownedInput = { ...legInput, entityId: later.feedstockId };
      const [ownedLeg] = await db.insert(transportLegs).values({ ...ownedInput, organizationId: TEST_ORG_ID }).returning();
      const locked = { code: "certification_locked" };
      await expect(createTransportLeg(ctx, ownedInput)).rejects.toMatchObject(locked);
      await expect(updateTransportLeg(ctx, ownedLeg.id, { expectedVersion: ownedLeg.version, distanceKm: 20 })).rejects.toMatchObject(locked);
      await expect(deleteTransportLeg(ctx, ownedLeg.id, ownedLeg.version)).rejects.toMatchObject(locked);

      const [stock] = await db.select().from(feedstocks).where(and(eq(feedstocks.organizationId, TEST_ORG_ID), eq(feedstocks.id, earlier.feedstockId)));
      await expect(db.transaction(tx => updateFeedstockInTransaction(ctx, tx, stock.id,
        { expectedVersion: stock.version, massWetKg: (stock.massWetKg ?? 0) + 1 }))).rejects.toMatchObject(locked);
      const saved = await db.transaction(tx => updateFeedstockInTransaction(ctx, tx, stock.id,
        { expectedVersion: stock.version, massWetKg: stock.massWetKg!, transportDistanceKm: 12, transportDistanceSource: "manual" }));
      expect(saved.distanceKmOverride).toBe(12);
      await expect(db.transaction(tx => updateFeedstockInTransaction(ctx, tx, stock.id,
        { expectedVersion: saved.version, transportDistanceKm: 13, notes: "Changed record notes" }))).rejects.toMatchObject(locked);
      const [ownedStock] = await db.select().from(feedstocks).where(and(eq(feedstocks.organizationId, TEST_ORG_ID), eq(feedstocks.id, later.feedstockId)));
      await expect(db.transaction(tx => updateFeedstockInTransaction(ctx, tx, ownedStock.id,
        { expectedVersion: ownedStock.version, transportDistanceKm: 12, transportDistanceSource: "manual" }))).rejects.toMatchObject(locked);

      const targets = [earlier, later].map(fixture => ({ entityType: "feedstock" as const, entityId: fixture.feedstockId, transportOnly: true }));
      const locks = await getRecordLocks(ctx, db, targets, { sentOnly: true });
      expect(locks.map(lock => lock.level)).toEqual(["open", "sent"]);
      expect((await getTransportDistanceDrift(ctx, { entityType: "feedstock", entityId: earlier.feedstockId })).hasSubmittedRemoval).toBe(false);
      expect((await getTransportDistanceDrift(ctx, { entityType: "feedstock", entityId: later.feedstockId })).hasSubmittedRemoval).toBe(true);
      expect((await getRecordLocks(ctx, db, [{ ...targets[0], transportOnly: false }], { sentOnly: true }))[0].level).toBe("sent");
    });
  }, "none");
});
