import { withGhgVerifierSubmissionLock } from "@/data-access/ghg-verifier-submission-lock";
import { withFacilityDurabilitySessionLock } from "@/data-access/facility-durability-lock";
import { getOutputMovementCertificationLocks } from "@/data-access/output-stock-edit-lock";
import { beforeEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { and, eq } from "drizzle-orm";
import { certificationSubmissions, certifierRemovals, creditBatches, feedstocks, productionRuns, samples, biocharProducts, orders, deliveries, applications } from "@/db/schema";
import { assertCanMutateCertifiedLineage, getRecordLock, getRecordLocks } from "@/data-access/certification-lineage-guards";
import { outputMovementLockReason } from "@/data-access/output-stock-edit-lock";
import { getOutputStockAllocationProjection } from "@/data-access/output-stock";
import { hasBlockingFacilitySubmission } from "@/data-access/certification";
import { lockCreditBatchArtifacts, assertRemovalAllowsCreditBatchMutation, isCreditBatchMembershipLockedBySubmission, CreditBatchLineageChangedError } from "@/data-access/credit-batch-certification-lock";
import { withLineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

const remote = vi.hoisted(() => ({ status: "DRAFT", submitted_at: "2026-10-01T12:00:00Z" as string | null, ghg_entry_ids: ["entry1", "entry2"], fail: false, calls: 0 }));
vi.mock("@/lib/isometric/ghg-statements", () => ({ getGhgStatement: async () => { remote.calls++; if (remote.fail) throw new Error("Registry unavailable"); return remote; } }));
vi.mock("@/data-access/certifier-credentials", () => ({ resolveIsometricClient: async () => ({}) }));

beforeAll(() => ensureTestOrg());
beforeEach(() => { remote.status = "DRAFT"; remote.submitted_at = "2026-10-01T12:00:00Z"; remote.fail = false; remote.calls = 0; });

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
      await db.update(certificationSubmissions).set({ metadata: { remoteStatus: "DRAFT", submittedToVerifierAt: "2026-10-01T12:00:00Z" } }).where(and(
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

describe('return identity and timing', () => {
  it.each([['2026-10-03', 'sent'], ['2026-10-01', 'inUse']])('real Removal v2 at %s yields %s', async (submittedAt, level) => {
    remote.status = 'FAILED_VERIFICATION';
    await withLineageFixture(async fixture => {
      await db.update(certificationSubmissions).set({ metadata: { remoteStatus: 'FAILED_VERIFICATION', returnedAt: '2026-10-02', removalIds: ['entry1', 'entry2'] } })
        .where(and(eq(certificationSubmissions.organizationId, TEST_ORG_ID), eq(certificationSubmissions.localEntityId, fixture.ghgStatementId!)));
      await db.insert(certificationSubmissions).values([
        { organizationId: TEST_ORG_ID, provider: 'isometric', localEntityType: 'removal', localEntityId: fixture.removalId, submissionType: 'removal', version: 1, status: 'superseded', externalId: 'entry1', submittedAt: new Date('2026-09-30') },
        { organizationId: TEST_ORG_ID, provider: 'isometric', localEntityType: 'removal', localEntityId: fixture.removalId, submissionType: 'removal', version: 2, status: 'submitted', externalId: 'entry2', submittedAt: new Date(submittedAt) },
      ]);
      expect((await db.transaction(tx => getRecordLock(makeTestOrgContext(), tx, { entityType: 'feedstock', entityId: fixture.feedstockId }))).level).toBe(level);
    }, 'ghgStatement');
  });
  it.each(['failed-read', 'unknown-status', 'missing-history'])('keeps Sent on %s', async mode => {
    remote.fail = mode === 'failed-read';
    remote.status = mode === 'unknown-status' ? 'FUTURE_STATUS' : 'DRAFT';
    remote.submitted_at = null;
    await withLineageFixture(async fixture => {
      await db.update(certificationSubmissions).set({ metadata: { remoteStatus: mode === 'missing-history' ? 'DRAFT' : 'FAILED_VERIFICATION' } })
        .where(and(eq(certificationSubmissions.organizationId, TEST_ORG_ID), eq(certificationSubmissions.localEntityId, fixture.ghgStatementId!)));
      await expect(db.transaction(tx => assertCanMutateCertifiedLineage(makeTestOrgContext(), tx, { entityType: 'feedstock', entityId: fixture.feedstockId }, 'update')))
        .rejects.toMatchObject({ code: 'certification_locked' });
    }, 'ghgStatement');
  });
});

it('finds historical membership and reopens membership under artifact locks', async () => {
  remote.status = 'FAILED_VERIFICATION';
  await withLineageFixture(async fixture => {
    await db.insert(certificationSubmissions).values({ organizationId: TEST_ORG_ID, provider: 'isometric', localEntityType: 'removal', localEntityId: fixture.removalId, submissionType: 'removal', version: 1, status: 'submitted', externalId: 'entry1', submittedAt: new Date('2026-09-30') });
    await db.update(certificationSubmissions).set({ metadata: { remoteStatus: 'FAILED_VERIFICATION', removalIds: ['entry1'] } })
      .where(and(eq(certificationSubmissions.organizationId, TEST_ORG_ID), eq(certificationSubmissions.localEntityId, fixture.ghgStatementId!)));
    await db.update(certifierRemovals).set({ ghgStatementId: null }).where(and(eq(certifierRemovals.organizationId, TEST_ORG_ID), eq(certifierRemovals.id, fixture.removalId)));
    await db.transaction(async tx => {
      const locked = await lockCreditBatchArtifacts(makeTestOrgContext(), tx, fixture.batchId);
      expect(locked[0].statementIds).toEqual([fixture.ghgStatementId]);
      expect(await isCreditBatchMembershipLockedBySubmission(makeTestOrgContext(), tx, fixture.batchId, locked)).toBe(false);
      await expect(isCreditBatchMembershipLockedBySubmission(makeTestOrgContext(), tx, fixture.batchId, locked.map(row => ({ ...row, statementIds: [] }))))
        .rejects.toBeInstanceOf(CreditBatchLineageChangedError);
    });
  }, 'ghgStatement');
});
it('holds facility mapping for a failed attempt with remote effects until deletion', async () => {
  await withLineageFixture(async fixture => {
    await db.update(certificationSubmissions).set({ status: 'rejected', externalId: 'entry1' })
      .where(and(eq(certificationSubmissions.organizationId, TEST_ORG_ID), eq(certificationSubmissions.localEntityId, fixture.removalId)));
    expect(await hasBlockingFacilitySubmission(makeTestOrgContext(), db, fixture.facilityId, 'isometric')).toBe(true);
  });
});
it('reads Open for each operational kind with no dependent records', async () => {
  await withLineageFixture(async fixture => {
    const rollback = new Error('rollback open fixtures');
    await expect(db.transaction(async tx => {
      const targets: Parameters<typeof getRecordLock>[2][] = [];
      for (const [entityType, table, sourceId] of [
        ['creditBatch', creditBatches, fixture.batchId], ['feedstock', feedstocks, fixture.feedstockId],
        ['productionRun', productionRuns, fixture.productionRunId], ['biocharProduct', biocharProducts, fixture.productId],
        ['order', orders, fixture.orderId], ['delivery', deliveries, fixture.deliveryId], ['application', applications, fixture.applicationId],
      ] as const) {
        const [source] = await tx.select().from(table).where(and(eq(table.organizationId, TEST_ORG_ID), eq(table.id, sourceId)));
        const id = crypto.randomUUID();
        const cloned = { ...source, id, code: `OPEN-${id}`, stockPostingSequence: undefined,
          ...(entityType === "productionRun" ? { startTime: new Date("2026-06-12T08:00:00Z") } : {}) };
        await tx.insert(table).values(cloned);
        targets.push({ entityType, entityId: id });
      }
      const [sample] = await tx.select().from(samples).where(and(eq(samples.organizationId, TEST_ORG_ID), eq(samples.id, fixture.sampleId)));
      const id = crypto.randomUUID();
      await tx.insert(samples).values({ ...sample, id, sampleCode: `OPEN-${id}`, creditBatchId: targets[0].entityId });
      expect((await getRecordLock(makeTestOrgContext(), tx, targets[0])).heldBy).toContainEqual({ kind: "sample", id });
      // The isolated batch has no dependents before the Sample is attached.
      for (const target of targets.filter(target => target.entityType !== 'creditBatch')) {
        expect((await getRecordLock(makeTestOrgContext(), tx, target)).level, target.entityType).toBe('open');
      }
      expect((await getRecordLock(makeTestOrgContext(), tx, { entityType: 'sample', entityId: id })).level).toBe('open');
      await tx.delete(samples).where(and(eq(samples.organizationId, TEST_ORG_ID), eq(samples.id, id)));
      expect((await getRecordLock(makeTestOrgContext(), tx, targets[0])).level).toBe('open');
      throw rollback;
    })).rejects.toBe(rollback);
  }, 'none');
});

it('stock history advisory sees the Sent lineage used by correction posting', async () => {
  await withLineageFixture(async fixture => {
    const [product] = await db.select().from(biocharProducts).where(and(eq(biocharProducts.organizationId, TEST_ORG_ID), eq(biocharProducts.id, fixture.productId)));
    const rows = await getOutputStockAllocationProjection(makeTestOrgContext(), { deliveryId: fixture.deliveryId });
    expect(rows.length).toBeGreaterThan(0);
    expect(await outputMovementLockReason(makeTestOrgContext(), product.storageLocationId!, rows[0].movement.id, db, { original: rows[0].movement, facilityId: fixture.facilityId, all: rows, layers: [] })).toContain('certification submission');
  });
});

it('reads a shared statement once and skips registry reads while a Removal is in flight', async () => {
  remote.status = 'FAILED_VERIFICATION';
  await withLineageFixture(async fixture => {
    await db.update(certificationSubmissions).set({ metadata: { remoteStatus: 'FAILED_VERIFICATION' } })
      .where(and(eq(certificationSubmissions.organizationId, TEST_ORG_ID), eq(certificationSubmissions.localEntityId, fixture.ghgStatementId!)));
    const targets = [{ entityType: 'feedstock' as const, entityId: fixture.feedstockId }, { entityType: 'creditBatch' as const, entityId: fixture.batchId }];
    await db.transaction(tx => getRecordLocks(makeTestOrgContext(), tx, targets));
    expect(remote.calls).toBe(1);
    await db.insert(certificationSubmissions).values({ organizationId: TEST_ORG_ID, provider: 'isometric', localEntityType: 'removal', localEntityId: fixture.removalId, submissionType: 'removal', version: 1, status: 'draft' });
    remote.calls = 0;
    const locks = await db.transaction(tx => getRecordLocks(makeTestOrgContext(), tx, targets));
    expect(locks.map(lock => lock.level)).toEqual(['sent', 'sent']);
    expect(remote.calls).toBe(0);
  }, 'ghgStatement');
});

it('serializes a paused verifier resubmission with a source edit', async () => {
  remote.status = 'FAILED_VERIFICATION';
  await withLineageFixture(async fixture => {
    const ctx = makeTestOrgContext();
    await expect(db.transaction(tx => assertCanMutateCertifiedLineage(ctx, tx,
      { entityType: 'feedstock', entityId: fixture.feedstockId }, 'update'))).resolves.toBeUndefined();
    let entered!: () => void;
    let resume!: () => void;
    const providerEntered = new Promise<void>(resolve => { entered = resolve; });
    const providerResume = new Promise<void>(resolve => { resume = resolve; });
    const resubmission = withFacilityDurabilitySessionLock(ctx, fixture.facilityId, () =>
      withGhgVerifierSubmissionLock(ctx, fixture.ghgStatementId!, async () => {
        entered();
        await providerResume;
        remote.status = 'AWAITING_VERIFICATION';
        await db.update(certificationSubmissions).set({ metadata: { remoteStatus: remote.status } }).where(and(
          eq(certificationSubmissions.organizationId, TEST_ORG_ID), eq(certificationSubmissions.localEntityId, fixture.ghgStatementId!),
        ));
      }));
    await providerEntered;
    let finished = false;
    const edit = db.transaction(tx => assertCanMutateCertifiedLineage(ctx, tx,
      { entityType: 'feedstock', entityId: fixture.feedstockId }, 'update'))
      .then(() => { finished = true; return null; }, error => { finished = true; return error; });
    try {
      // Give the source writer time to reach the held artifact lock.
      const OBSERVATION_MS = 100;
      await new Promise(resolve => setTimeout(resolve, OBSERVATION_MS));
      expect(finished).toBe(false);
    } finally {
      resume();
      await resubmission;
    }
    expect(await edit).toMatchObject({ code: 'certification_locked' });
  }, 'ghgStatement');
});

it('reads the registry once for N stock entries sharing a statement', async () => {
  remote.status = 'FAILED_VERIFICATION';
  await withLineageFixture(async fixture => {
    const ctx = makeTestOrgContext();
    const rows = await getOutputStockAllocationProjection(ctx, { deliveryId: fixture.deliveryId });
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    const entries = ids.flatMap(id => rows.map(row => ({ ...row, movement: { ...row.movement, id } })));
    const locks = await getOutputMovementCertificationLocks(ctx, db, ids, entries);
    expect(locks.size).toBe(ids.length);
    expect(remote.calls).toBe(1);
    expect([...locks.values()].every(entry => entry.length > 0)).toBe(true);
  }, 'ghgStatement');
});

it('membership refusal names an interrupted Removal and tells the operator to resume it', async () => {
  await withLineageFixture(async fixture => {
    await db.update(certificationSubmissions).set({ status: 'draft' }).where(and(
      eq(certificationSubmissions.organizationId, TEST_ORG_ID), eq(certificationSubmissions.localEntityId, fixture.removalId),
    ));
    await db.transaction(async tx => {
      const ctx = makeTestOrgContext();
      const locked = await lockCreditBatchArtifacts(ctx, tx, fixture.batchId);
      await expect(assertRemovalAllowsCreditBatchMutation(ctx, tx, fixture.batchId, 'update', locked)).rejects.toMatchObject({
        code: 'certification_locked', message: expect.stringContaining(`Removal ${fixture.removalId}`),
      });
      await expect(assertRemovalAllowsCreditBatchMutation(ctx, tx, fixture.batchId, 'update', locked)).rejects.toThrow('Delete or resume the interrupted Removal');
    });
  });
});
