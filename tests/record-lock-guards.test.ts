import { beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { and, eq } from "drizzle-orm";
import { certificationSubmissions } from "@/db/schema";
import { assertCanMutateCertifiedLineage, getRecordLock } from "@/data-access/certification-lineage-guards";
import { withLineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

const remote = vi.hoisted(() => ({ status: "DRAFT", submitted_at: "2026-10-01T12:00:00Z" as string | null }));
vi.mock("@/lib/isometric/ghg-statements", () => ({ getGhgStatement: async () => remote }));
vi.mock("@/data-access/certifier-credentials", () => ({ resolveIsometricClient: async () => ({}) }));

beforeAll(() => ensureTestOrg());

describe("record lock guards under real database locks", () => {
  it("reads In use independently of certification status for each numeric consumer", async () => {
    await withLineageFixture(async fixture => {
      const targets = [
        ["feedstock", fixture.feedstockId], ["productionRun", fixture.productionRunId],
        ["sample", fixture.sampleId], ["biocharProduct", fixture.productId],
        ["order", fixture.orderId], ["delivery", fixture.deliveryId],
        ["application", fixture.applicationId], ["creditBatch", fixture.batchId],
      ] as const;
      for (const [entityType, entityId] of targets) {
        const lock = await db.transaction(tx => getRecordLock(makeTestOrgContext(), tx, { entityType, entityId }));
        expect(lock.level, entityType).toBe("inUse");
        expect(lock.heldBy.length, entityType).toBeGreaterThan(0);
      }
    }, "none");
  });

  it("does not treat a failed statement creation with no remote effects as Sent", async () => {
    await withLineageFixture(async fixture => {
      await db.update(certificationSubmissions).set({ status: "rejected", externalId: null, metadata: {} }).where(and(
        eq(certificationSubmissions.organizationId, TEST_ORG_ID),
        eq(certificationSubmissions.localEntityId, fixture.ghgStatementId!),
      ));
      await expect(db.transaction(tx => assertCanMutateCertifiedLineage(makeTestOrgContext(), tx,
        { entityType: "feedstock", entityId: fixture.feedstockId }, "update"))).resolves.toBeUndefined();
    }, "ghgStatement");
  });

  it("fails closed on an unknown saved registry status even after a rejected attempt", async () => {
    await withLineageFixture(async fixture => {
      await db.update(certificationSubmissions).set({ status: "rejected", externalId: null, metadata: { remoteStatus: "UNKNOWN" } }).where(and(
        eq(certificationSubmissions.organizationId, TEST_ORG_ID),
        eq(certificationSubmissions.localEntityId, fixture.ghgStatementId!),
      ));
      await expect(db.transaction(tx => assertCanMutateCertifiedLineage(makeTestOrgContext(), tx,
        { entityType: "feedstock", entityId: fixture.feedstockId }, "update"))).rejects.toMatchObject({ code: "certification_locked" });
    }, "ghgStatement");
  });

  it.each(["FAILED_VERIFICATION", "DRAFT"])("reopens on fresh %s, including a Certify web submission", async status => {
    remote.status = status;
    await withLineageFixture(async fixture => {
      await db.update(certificationSubmissions).set({ metadata: { remoteStatus: "DRAFT" } }).where(and(
        eq(certificationSubmissions.organizationId, TEST_ORG_ID),
        eq(certificationSubmissions.localEntityId, fixture.ghgStatementId!),
      ));
      await expect(db.transaction(tx => assertCanMutateCertifiedLineage(makeTestOrgContext(), tx,
        { entityType: "feedstock", entityId: fixture.feedstockId }, "update"))).resolves.toBeUndefined();
      remote.status = "AWAITING_VERIFICATION";
      await expect(db.transaction(tx => assertCanMutateCertifiedLineage(makeTestOrgContext(), tx,
        { entityType: "feedstock", entityId: fixture.feedstockId }, "update"))).rejects.toMatchObject({ code: "certification_locked" });
    }, "ghgStatement");
  });

  it("returns the shared domain code for every record in a submitted lineage with a failed retry", async () => {
    await withLineageFixture(async fixture => {
      await db.insert(certificationSubmissions).values({ organizationId: TEST_ORG_ID,
        provider: "isometric", localEntityType: "removal", localEntityId: fixture.removalId,
        submissionType: "removal", version: 2, status: "rejected" });
      const targets = [
        ["feedstock", fixture.feedstockId], ["productionRun", fixture.productionRunId],
        ["sample", fixture.sampleId], ["biocharProduct", fixture.productId],
        ["order", fixture.orderId], ["delivery", fixture.deliveryId],
        ["application", fixture.applicationId], ["creditBatch", fixture.batchId],
      ] as const;
      for (const [entityType, entityId] of targets) {
        await expect(db.transaction(tx => assertCanMutateCertifiedLineage(
          makeTestOrgContext(), tx, { entityType, entityId }, "update",
        ))).rejects.toMatchObject({ code: "certification_locked" });
      }
    });
  });
});
