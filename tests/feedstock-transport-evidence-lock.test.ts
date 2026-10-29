import { beforeAll, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { certificationSubmissions, documents, productionRunFeedstocks, productionRuns, storageObjectDeletions } from "@/db/schema";
import { getRecordLockViews } from "@/data-access/record-lock-views";
import { getRecordCertificationLock } from "@/data-access/record-certification-lock";
import { getFeedstockTransportOwners } from "@/data-access/feedstock-transport-ownership";
import { requestDocumentUploadInTransaction, confirmDocumentUploadInTransaction, uploadFactsFor } from "@/data-access/document-writes";
import { inspectUploadOwner } from "@/data-access/document-upload-preparation";
import { renewDocumentUploadInTransaction } from "@/data-access/document-upload-renewal";
import { collectCandidateSourceDocumentsForRemoval, loadCandidateDocumentsForRemovalForUser } from "@/fn/certification/source-candidates";
import { withLineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

beforeAll(() => ensureTestOrg());

it("keeps the full transport lineage locked when no eligible owner exists", async () => {
  const ctx = makeTestOrgContext();
  // The unsubmitted fixture links a running run, which cannot own transport.
  await withLineageFixture(async fixture => {
    expect((await getFeedstockTransportOwners(ctx, [fixture.feedstockId])).has(fixture.feedstockId)).toBe(false);
    const upload = { entityType: "feedstock" as const, entityId: fixture.feedstockId, documentType: "bill_of_lading" as const,
      fileName: "receipt.pdf", contentType: "application/pdf", sizeBytes: 1, storageProvider: "local-fs", storageBucket: "test" };
    const pending = await db.transaction(tx => requestDocumentUploadInTransaction(ctx, tx, upload));
    try {
      await db.insert(certificationSubmissions).values({ organizationId: TEST_ORG_ID, provider: "isometric", submissionType: "removal",
        localEntityType: "removal", localEntityId: fixture.removalId, externalId: `ext_${fixture.removalId}`, version: 1,
        status: "submitted", submittedAt: new Date(), payloadHash: "test", payloadSnapshot: {} });

      expect((await getRecordLockViews(ctx, "feedstock", [fixture.feedstockId]))[fixture.feedstockId].transport)
        .toMatchObject({ level: "sent", heldBy: [{ kind: "removal", id: fixture.removalId }] });
      expect(await getRecordCertificationLock(ctx, { entityType: "feedstock", entityId: fixture.feedstockId, scope: "transport" })).toBe(true);
      await expect(db.transaction(tx => requestDocumentUploadInTransaction(ctx, tx, upload)))
        .rejects.toMatchObject({ code: "certification_locked" });
      expect(await inspectUploadOwner(ctx, pending)).toBe(true);
      expect(await db.transaction(tx => renewDocumentUploadInTransaction(ctx, tx, pending.id)))
        .toMatchObject({ kind: "unavailable", reason: "certification_locked" });
      expect(await db.transaction(tx => confirmDocumentUploadInTransaction(ctx, tx, uploadFactsFor(pending))))
        .toMatchObject({ kind: "refused", reason: "certification_locked" });
    } finally {
      await db.delete(storageObjectDeletions).where(and(eq(storageObjectDeletions.organizationId, TEST_ORG_ID), eq(storageObjectDeletions.storageKey, pending.storageKey!)));
      await db.delete(documents).where(and(eq(documents.organizationId, TEST_ORG_ID), eq(documents.entityId, fixture.feedstockId), eq(documents.entityType, "feedstock")));
    }
  }, "none");
});

it("keeps transport views and BoL writes open until the owner Removal is sent, and excludes other owners' Sources", async () => {
  const ctx = makeTestOrgContext();
  await withLineageFixture(async owner => {
    await db.update(productionRuns).set({ status: "complete", startTime: new Date("2026-06-12T08:00:00Z"), endTime: new Date("2026-06-12T12:00:00Z") })
      .where(and(eq(productionRuns.organizationId, TEST_ORG_ID), eq(productionRuns.id, owner.productionRunId)));
    await withLineageFixture(async later => {
      await db.insert(productionRunFeedstocks).values({ organizationId: TEST_ORG_ID,
        productionRunId: later.productionRunId, feedstockId: owner.feedstockId, wetMassUsedKg: 1 });
      const ids = [owner.feedstockId, later.feedstockId];
      const lineageQueries = vi.spyOn(db, "selectDistinct");
      const views = await getRecordLockViews(ctx, "feedstock", ids);
      expect(lineageQueries).toHaveBeenCalledTimes(2);
      lineageQueries.mockRestore();
      expect(views[owner.feedstockId]).toMatchObject({ level: "sent", transport: { level: "open", heldBy: [] } });
      expect(views[later.feedstockId].transport).toMatchObject({ level: "sent", heldBy: [{ kind: "removal", id: later.removalId }] });
      expect(await getRecordLockViews(ctx, "feedstock", [crypto.randomUUID()])).toEqual({});
      expect(await getRecordLockViews({ ...ctx, organizationId: crypto.randomUUID() }, "feedstock", ids)).toEqual({});
      expect((await getRecordLockViews(ctx, "productionRun", [later.productionRunId]))[later.productionRunId]).not.toHaveProperty("transport");
      expect(await getRecordCertificationLock(ctx, { entityType: "feedstock", entityId: owner.feedstockId })).toBe(true);
      expect(await getRecordCertificationLock(ctx, { entityType: "feedstock", entityId: owner.feedstockId, scope: "transport" })).toBe(false);
      const upload = { entityType: "feedstock" as const, entityId: owner.feedstockId, documentType: "bill_of_lading" as const,
        fileName: "receipt.pdf", contentType: "application/pdf", sizeBytes: 1, storageProvider: "local-fs", storageBucket: "test" };
      const locked = { code: "certification_locked" };
      const uploadKeys: string[] = [];
      try {
        const pending = await db.transaction(tx => requestDocumentUploadInTransaction(ctx, tx, upload));
        uploadKeys.push(pending.storageKey!);
        expect(await inspectUploadOwner(ctx, pending)).toBe(false);
        expect(await db.transaction(tx => renewDocumentUploadInTransaction(ctx, tx, pending.id))).toMatchObject({ kind: "renewed" });
        const confirmed = await db.transaction(tx => confirmDocumentUploadInTransaction(ctx, tx, {
          ...uploadFactsFor(pending), finalKey: `${pending.storageKey}-final`, inspectedSizeBytes: 1,
          inspectedSha256: "a".repeat(64), inspectedContentType: "application/pdf",
        }));
        expect(confirmed.kind).toBe("uploaded");
        await expect(db.transaction(tx => requestDocumentUploadInTransaction(ctx, tx, { ...upload, documentType: "pdf" }))).rejects.toMatchObject(locked);
        await expect(db.transaction(tx => requestDocumentUploadInTransaction(ctx, tx, { ...upload, entityId: later.feedstockId }))).rejects.toMatchObject(locked);

        const laterCandidates = await loadCandidateDocumentsForRemovalForUser(ctx, later.removalId);
        expect(laterCandidates.candidates.map(candidate => candidate.document.id)).not.toContain(pending.id);
        const ownerCandidates = await loadCandidateDocumentsForRemovalForUser(ctx, owner.removalId);
        expect(ownerCandidates.candidates.map(candidate => candidate.document.id)).toContain(pending.id);
        const lineages = [{ application: { id: later.applicationId }, delivery: { id: later.deliveryId },
          feedstocks: [{ id: owner.feedstockId, ownsTransport: false }] }];
        expect(await collectCandidateSourceDocumentsForRemoval(ctx, { removalId: later.removalId, lineages, transportFeedstockIds: [] })).toEqual([]);
        expect((await collectCandidateSourceDocumentsForRemoval(ctx, { removalId: owner.removalId, lineages: [], transportFeedstockIds: [owner.feedstockId] }))
          .map(candidate => candidate.documentId)).toContain(pending.id);

        const awaitingConfirm = await db.transaction(tx => requestDocumentUploadInTransaction(ctx, tx, upload));
        uploadKeys.push(awaitingConfirm.storageKey!);
        await db.insert(certificationSubmissions).values({ organizationId: TEST_ORG_ID, provider: "isometric", submissionType: "removal",
          localEntityType: "removal", localEntityId: owner.removalId, externalId: `ext_${owner.removalId}`, version: 1,
          status: "submitted", submittedAt: new Date(), payloadHash: "test", payloadSnapshot: {} });
        expect((await getRecordLockViews(ctx, "feedstock", ids))[owner.feedstockId].transport)
          .toMatchObject({ level: "sent", heldBy: [{ kind: "removal", id: owner.removalId }] });
        expect(await getRecordCertificationLock(ctx, { entityType: "feedstock", entityId: owner.feedstockId, scope: "transport" })).toBe(true);
        await expect(db.transaction(tx => requestDocumentUploadInTransaction(ctx, tx, upload))).rejects.toMatchObject(locked);
        expect(await inspectUploadOwner(ctx, awaitingConfirm)).toBe(true);
        expect(await db.transaction(tx => renewDocumentUploadInTransaction(ctx, tx, awaitingConfirm.id)))
          .toMatchObject({ kind: "unavailable", reason: "certification_locked" });
        expect(await db.transaction(tx => confirmDocumentUploadInTransaction(ctx, tx, uploadFactsFor(awaitingConfirm))))
          .toMatchObject({ kind: "refused", reason: "certification_locked" });
      } finally {
        if (uploadKeys.length) await db.delete(storageObjectDeletions).where(and(eq(storageObjectDeletions.organizationId, TEST_ORG_ID), inArray(storageObjectDeletions.storageKey, uploadKeys)));
        await db.delete(documents).where(and(eq(documents.organizationId, TEST_ORG_ID), eq(documents.entityType, "feedstock"), inArray(documents.entityId, ids)));
      }
    });
  }, "none");
});
