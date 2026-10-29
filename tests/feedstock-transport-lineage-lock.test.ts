import { beforeAll, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { certificationSubmissions, creditBatchProductionRuns, feedstocks, productionRunFeedstocks, productionRuns, transportLegs } from "@/db/schema";
import { createTransportLeg, deleteTransportLeg, updateTransportLeg } from "@/data-access/transport-legs";
import { updateFeedstockInTransaction } from "@/data-access/feedstocks";
import { getRecordCertificationLock } from "@/data-access/record-certification-lock";
import { getFeedstockTransportOwners } from "@/data-access/feedstock-transport-ownership";
import { getRecordLocks } from "@/data-access/certification-lineage-guards";
import { getTransportDistanceDrift } from "@/data-access/transport-distance-drift";
import { SUBMISSION_EXTERNAL_MUTATIONS, SUBMISSION_METADATA_KEYS } from "@/lib/certification/submission-metadata";
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
      await db.update(productionRuns).set({ status: "complete", endTime: new Date("2026-06-13T12:00:00Z") })
        .where(and(eq(productionRuns.organizationId, TEST_ORG_ID), eq(productionRuns.id, later.productionRunId)));
      await insertSubmission(later.removalId, { transportFeedstockIds: [later.feedstockId] }, state);
      const legInput = { entityType: "feedstock" as const, entityId: earlier.feedstockId,
        distanceKm: 10, loadMassKg: 1000, transportMethodType: "road" as const };
      const leg = await createTransportLeg(ctx, legInput);
      expect(await getRecordCertificationLock(ctx, { entityType: "transport_leg", entityId: leg.id, scope: "transport" })).toBe(false);
      expect(await getRecordCertificationLock(ctx, { entityType: "transport_leg", entityId: leg.id })).toBe(true);
      const updated = await updateTransportLeg(ctx, leg.id, { expectedVersion: leg.version, distanceKm: 20 });
      expect(updated.distanceKm).toBe(20);
      await deleteTransportLeg(ctx, updated.id, updated.version);
      expect(await db.select().from(transportLegs).where(and(eq(transportLegs.organizationId, TEST_ORG_ID), eq(transportLegs.id, leg.id)))).toEqual([]);

      const ownedInput = { ...legInput, entityId: later.feedstockId };
      const [ownedLeg] = await db.insert(transportLegs).values({ ...ownedInput, organizationId: TEST_ORG_ID }).returning();
      expect(await getRecordCertificationLock(ctx, { entityType: "transport_leg", entityId: ownedLeg.id, scope: "transport" })).toBe(true);
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
    }, "none");
  }, "none");
});

async function insertSubmission(removalId: string, payloadSnapshot: Record<string, unknown>, state: "sent" | "reserved" | "rejected" = "sent",
  options: { version?: number; externalId?: string; metadata?: Record<string, unknown> } = {}) {
  const [submission] = await db.insert(certificationSubmissions).values({
    organizationId: TEST_ORG_ID, provider: "isometric", submissionType: "removal",
    localEntityType: "removal", localEntityId: removalId, version: options.version ?? 1,
    status: state === "rejected" ? "rejected" : "draft", payloadSnapshot, lockedAt: state === "reserved" ? new Date() : null,
    externalId: options.externalId, metadata: options.metadata,
  }).returning();
  if (state === "sent") {
    await db.update(certificationSubmissions).set({ status: "submitted", submittedAt: new Date(), externalId: `ext_${submission.id}` })
      .where(and(eq(certificationSubmissions.organizationId, TEST_ORG_ID), eq(certificationSubmissions.id, submission.id)));
  }
}

it("releases transport listed only by a rejected attempt with no registry mutation", async () => {
  const ctx = makeTestOrgContext();
  await withLineageFixture(async earlier => {
    await db.update(productionRuns).set({ status: "complete", startTime: new Date("2026-06-12T08:00:00Z"), endTime: new Date("2026-06-12T12:00:00Z") })
      .where(and(eq(productionRuns.organizationId, TEST_ORG_ID), eq(productionRuns.id, earlier.productionRunId)));
    await withLineageFixture(async later => {
      await db.insert(productionRunFeedstocks).values({ organizationId: TEST_ORG_ID,
        productionRunId: later.productionRunId, feedstockId: earlier.feedstockId, wetMassUsedKg: 1 });
      await db.update(productionRuns).set({ status: "complete", endTime: new Date("2026-06-13T12:00:00Z") })
        .where(and(eq(productionRuns.organizationId, TEST_ORG_ID), eq(productionRuns.id, later.productionRunId)));
      await insertSubmission(later.removalId, { transportFeedstockIds: [earlier.feedstockId] }, "rejected");
      await insertSubmission(later.removalId, { transportFeedstockIds: [later.feedstockId] }, "sent", { version: 2 });

      expect((await getRecordLocks(ctx, db, [{ entityType: "feedstock", entityId: earlier.feedstockId, transportOnly: true }], { sentOnly: true }))[0].level).toBe("open");
      const leg = await createTransportLeg(ctx, { entityType: "feedstock", entityId: earlier.feedstockId,
        distanceKm: 10, loadMassKg: 1000, transportMethodType: "road" });
      const updated = await updateTransportLeg(ctx, leg.id, { expectedVersion: leg.version, distanceKm: 20 });
      expect(updated.distanceKm).toBe(20);
      await deleteTransportLeg(ctx, updated.id, updated.version);
    }, "none");
  }, "none");
});

it.each(["externalId", "possible"] as const)("keeps transport locked when a rejected attempt has %s remote-effect evidence", async remoteEffect => {
  const ctx = makeTestOrgContext();
  await withLineageFixture(async earlier => {
    await db.update(productionRuns).set({ status: "complete", startTime: new Date("2026-06-12T08:00:00Z"), endTime: new Date("2026-06-12T12:00:00Z") })
      .where(and(eq(productionRuns.organizationId, TEST_ORG_ID), eq(productionRuns.id, earlier.productionRunId)));
    await withLineageFixture(async later => {
      await db.insert(productionRunFeedstocks).values({ organizationId: TEST_ORG_ID,
        productionRunId: later.productionRunId, feedstockId: earlier.feedstockId, wetMassUsedKg: 1 });
      await db.update(productionRuns).set({ status: "complete", endTime: new Date("2026-06-13T12:00:00Z") })
        .where(and(eq(productionRuns.organizationId, TEST_ORG_ID), eq(productionRuns.id, later.productionRunId)));
      await insertSubmission(later.removalId, { transportFeedstockIds: [earlier.feedstockId] }, "rejected",
        remoteEffect === "externalId" ? { externalId: `ext_rejected_${later.removalId}` } : {
          metadata: { [SUBMISSION_METADATA_KEYS.externalMutation]: SUBMISSION_EXTERNAL_MUTATIONS.possible },
        });
      await insertSubmission(later.removalId, { transportFeedstockIds: [later.feedstockId] }, "sent", { version: 2 });

      expect((await getRecordLocks(ctx, db, [{ entityType: "feedstock", entityId: earlier.feedstockId, transportOnly: true }], { sentOnly: true }))[0].level).toBe("sent");
    }, "none");
  }, "none");
});

// "reserved" stands for an interrupted attempt: its draft snapshot may already have reached the registry.
it.each([["counted", "sent"], ["legacy", "sent"], ["counted", "reserved"]] as const)("keeps %s %s transport locked after an earlier run becomes batched", async (snapshotKind, state) => {
  const ctx = makeTestOrgContext();
  await withLineageFixture(async earlier => {
    await db.update(productionRuns).set({ status: "complete", startTime: new Date("2026-02-12T08:00:00Z"), endTime: new Date("2026-02-12T12:00:00Z") })
      .where(and(eq(productionRuns.organizationId, TEST_ORG_ID), eq(productionRuns.id, earlier.productionRunId)));
    await db.delete(creditBatchProductionRuns).where(and(eq(creditBatchProductionRuns.organizationId, TEST_ORG_ID), eq(creditBatchProductionRuns.creditBatchId, earlier.batchId)));
    await withLineageFixture(async march => {
      await db.update(productionRuns).set({ status: "complete", startTime: new Date("2026-03-12T08:00:00Z"), endTime: new Date("2026-03-12T12:00:00Z") })
        .where(and(eq(productionRuns.organizationId, TEST_ORG_ID), eq(productionRuns.id, march.productionRunId)));
      await db.insert(productionRunFeedstocks).values({ organizationId: TEST_ORG_ID,
        productionRunId: march.productionRunId, feedstockId: earlier.feedstockId, wetMassUsedKg: 1 });
      const [leg] = await db.insert(transportLegs).values({ organizationId: TEST_ORG_ID,
        entityType: "feedstock", entityId: earlier.feedstockId, distanceKm: 10, loadMassKg: 1000, transportMethodType: "road" }).returning();
      expect((await getFeedstockTransportOwners(ctx, [earlier.feedstockId])).get(earlier.feedstockId)).toBe(march.productionRunId);
      await insertSubmission(march.removalId, snapshotKind === "counted" ? { transportFeedstockIds: [earlier.feedstockId] } : {}, state);
      await db.insert(creditBatchProductionRuns).values({ organizationId: TEST_ORG_ID,
        creditBatchId: earlier.batchId, productionRunId: earlier.productionRunId });
      expect((await getFeedstockTransportOwners(ctx, [earlier.feedstockId])).get(earlier.feedstockId)).toBe(earlier.productionRunId);
      const locked = { code: "certification_locked" };
      await expect(updateTransportLeg(ctx, leg.id, { expectedVersion: leg.version, distanceKm: 20 })).rejects.toMatchObject(locked);
      await expect(deleteTransportLeg(ctx, leg.id, leg.version)).rejects.toMatchObject(locked);
      if (state === "sent") {
        expect((await getRecordLocks(ctx, db, [{ entityType: "feedstock", entityId: earlier.feedstockId, transportOnly: true }], { sentOnly: true }))[0].level).toBe("sent");
        expect(await getRecordCertificationLock(ctx, { entityType: "transport_leg", entityId: leg.id, scope: "transport" })).toBe(true);
      }
    }, "none");
  }, "none");
});
