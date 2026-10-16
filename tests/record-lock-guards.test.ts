import { withGhgVerifierSubmissionLock } from "@/data-access/ghg-verifier-submission-lock";
import { runOwnedTransaction } from "@/data-access/owned-transaction";
import { withFacilityDurabilitySessionLock } from "@/data-access/facility-durability-lock";
import { getOutputMovementCertificationLocks } from "@/data-access/output-stock-edit-lock";
import { beforeEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db, withDedicatedLockConnection } from "@/db";
import type { PoolClient } from "pg";
import { pgSchema, integer, text } from "drizzle-orm/pg-core";
import { assertOutputLayersMutable } from "@/data-access/output-stock-lineage";
import { and, eq } from "drizzle-orm";
import { certificationSubmissions, certifierRemovals, creditBatchProductionRuns, creditBatches, feedstocks, productionRuns, samples, biocharProducts, orders, deliveries, applications } from "@/db/schema";
import { assertCanMutateCertifiedLineage, getCertifiedLineage, getRecordLock, getRecordLocks } from "@/data-access/certification-lineage-guards";
import { outputMovementLockReason } from "@/data-access/output-stock-edit-lock";
import { getOutputStockAllocationProjection } from "@/data-access/output-stock";
import { hasBlockingFacilitySubmission } from "@/data-access/certification";
import { lockCreditBatchArtifacts, assertRemovalAllowsCreditBatchMutation, isCreditBatchMembershipLockedBySubmission, CreditBatchLineageChangedError } from "@/data-access/credit-batch-certification-lock";
import { withLineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

const LOCK_OBSERVATION_TIMEOUT_MS = 5_000;
const SAVEPOINT_GUARD_BUDGET_MS = 750;
const pgActivity = pgSchema("pg_catalog").view("pg_stat_activity", {
  pid: integer("pid"), waitEventType: text("wait_event_type"), waitEvent: text("wait_event"),
}).existing();

const remote = vi.hoisted(() => ({ status: "DRAFT", submitted_at: "2026-10-01T12:00:00Z" as string | null, ghg_entry_ids: ["entry1", "entry2"], fail: false, calls: 0, stall: false }));
vi.mock("@/lib/isometric/ghg-statements", () => ({ getGhgStatement: async (_client: unknown, _id: string, options?: { signal?: AbortSignal }) => { remote.calls++; if (remote.stall) return new Promise((_, reject) => options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true })); if (remote.fail) throw new Error("Registry unavailable"); return remote; } }));
vi.mock("@/data-access/certifier-credentials", () => ({ resolveIsometricClient: async () => ({}) }));

beforeAll(() => ensureTestOrg());
beforeEach(() => { remote.status = "DRAFT"; remote.submitted_at = "2026-10-01T12:00:00Z"; remote.fail = false; remote.calls = 0; remote.stall = false; });

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
    expect(await outputMovementLockReason(makeTestOrgContext(), product.storageLocationId!, rows[0].movement.id, db, { original: rows[0].movement, facilityId: fixture.facilityId, all: rows, layers: [] })).toContain("Held by a Removal.");
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
    await db.update(certificationSubmissions).set({ metadata: { remoteStatus: 'FAILED_VERIFICATION' } }).where(and(eq(certificationSubmissions.organizationId, TEST_ORG_ID), eq(certificationSubmissions.localEntityId, fixture.ghgStatementId!)));
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
    let writerPid: number | undefined;
    const acquired = (client: PoolClient) => { writerPid = (client as PoolClient & { processID: number }).processID; };
    db.$client.once('acquire', acquired);
    const edit = db.transaction(tx => assertCanMutateCertifiedLineage(ctx, tx,
      { entityType: 'feedstock', entityId: fixture.feedstockId }, 'update'))
      .then(() => { finished = true; return null; }, error => { finished = true; return error; });
    try {
      await expect.poll(async () => {
        if (!writerPid) return undefined;
        return withDedicatedLockConnection(async observer => {
          const [activity] = await observer.select().from(pgActivity).where(eq(pgActivity.pid, writerPid!));
          return activity;
        });
      }, { timeout: LOCK_OBSERVATION_TIMEOUT_MS }).toMatchObject({ waitEventType: 'Lock', waitEvent: 'advisory' });
      expect(finished).toBe(false);
    } finally {
      db.$client.removeListener('acquire', acquired);
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
    await db.update(certificationSubmissions).set({ metadata: { remoteStatus: 'FAILED_VERIFICATION' } }).where(and(eq(certificationSubmissions.organizationId, TEST_ORG_ID), eq(certificationSubmissions.localEntityId, fixture.ghgStatementId!)));
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
        code: 'certification_locked', message: expect.stringContaining("Held by a Removal."),
      });
      await expect(assertRemovalAllowsCreditBatchMutation(ctx, tx, fixture.batchId, 'update', locked)).rejects.toThrow('Delete or resume the interrupted Removal');
    });
  });
});


it('deduplicates lineage facts and refreshes each statement once across versions and guarded layers', async () => {
  remote.status = 'FAILED_VERIFICATION';
  await withLineageFixture(async fixture => {
    const rollback = new Error('rollback expanded lineage');
    await expect(db.transaction(async tx => {
      const ctx = makeTestOrgContext();
      const [run] = await tx.select().from(productionRuns).where(and(eq(productionRuns.organizationId, TEST_ORG_ID), eq(productionRuns.id, fixture.productionRunId)));
      const runId = crypto.randomUUID();
      await tx.insert(productionRuns).values({ ...run, id: runId, code: `EXTRA-${runId}`, startTime: new Date('2026-06-12T08:00:00Z') });
      await tx.insert(creditBatchProductionRuns).values({ organizationId: TEST_ORG_ID, creditBatchId: fixture.batchId, productionRunId: runId });
      const [statement] = await tx.select().from(certificationSubmissions).where(and(eq(certificationSubmissions.organizationId, TEST_ORG_ID), eq(certificationSubmissions.localEntityId, fixture.ghgStatementId!)));
      await tx.update(certificationSubmissions).set({ metadata: { remoteStatus: 'FAILED_VERIFICATION' } }).where(and(eq(certificationSubmissions.organizationId, TEST_ORG_ID), eq(certificationSubmissions.id, statement.id)));
      await tx.insert(certificationSubmissions).values({ ...statement, id: crypto.randomUUID(), externalId: `${statement.externalId}-v2`, version: 2, metadata: { remoteStatus: 'FAILED_VERIFICATION' } });
      await tx.insert(certificationSubmissions).values([
        { organizationId: TEST_ORG_ID, provider: 'isometric', localEntityType: 'removal', localEntityId: fixture.removalId, submissionType: 'removal', version: 1, status: 'superseded', externalId: 'entry1', submittedAt: new Date('2026-09-30') },
        { organizationId: TEST_ORG_ID, provider: 'isometric', localEntityType: 'removal', localEntityId: fixture.removalId, submissionType: 'removal', version: 2, status: 'submitted', externalId: 'entry2', submittedAt: new Date('2026-09-30') },
      ]);
      await assertOutputLayersMutable(ctx, tx, 'biochar', [fixture.productionRunId, runId]);
      expect(remote.calls).toBe(2);
      const facts = await getCertifiedLineage(ctx, tx, { entityType: 'creditBatch', entityId: fixture.batchId });
      expect(facts).toHaveLength(1);
      expect(facts[0].recordLockRemoval.submissions).toHaveLength(2);
      expect(facts[0].recordLockRemoval.statements).toHaveLength(2);
      expect(remote.calls).toBe(2);
      throw rollback;
    })).rejects.toBe(rollback);
  }, 'ghgStatement');
});

it.each(['VERIFIED', 'CREDITS_ISSUED', 'AWAITING_VERIFICATION', 'DRAFT'])('never refreshes non-reopenable saved %s', async status => {
  await withLineageFixture(async fixture => {
    await db.update(certificationSubmissions).set({ metadata: { remoteStatus: status } }).where(and(eq(certificationSubmissions.organizationId, TEST_ORG_ID), eq(certificationSubmissions.localEntityId, fixture.ghgStatementId!)));
    await expect(db.transaction(tx => assertCanMutateCertifiedLineage(makeTestOrgContext(), tx, { entityType: 'feedstock', entityId: fixture.feedstockId }, 'update'))).rejects.toMatchObject({ code: 'certification_locked' });
    expect(remote.calls).toBe(0);
  }, 'ghgStatement');
});

it('fails closed when a fresh statement read exceeds its timeout', async () => {
  remote.stall = true;
  await withLineageFixture(async fixture => {
    await db.update(certificationSubmissions).set({ metadata: { remoteStatus: 'FAILED_VERIFICATION' } }).where(and(eq(certificationSubmissions.organizationId, TEST_ORG_ID), eq(certificationSubmissions.localEntityId, fixture.ghgStatementId!)));
    await expect(db.transaction(tx => assertCanMutateCertifiedLineage(makeTestOrgContext(), tx, { entityType: 'feedstock', entityId: fixture.feedstockId }, 'update'))).rejects.toMatchObject({ code: 'certification_locked' });
    expect(remote.calls).toBe(1);
  }, 'ghgStatement');
});

it('preserves the Sent refusal when a registry read stalls inside an owned savepoint', async () => {
  remote.stall = true;
  await withLineageFixture(async fixture => {
    await db.update(certificationSubmissions).set({ metadata: { remoteStatus: 'FAILED_VERIFICATION' } }).where(and(
      eq(certificationSubmissions.organizationId, TEST_ORG_ID),
      eq(certificationSubmissions.localEntityId, fixture.ghgStatementId!),
    ));
    const ctx = makeTestOrgContext();
    const result = runOwnedTransaction(ctx, Date.now() + SAVEPOINT_GUARD_BUDGET_MS, tx =>
      tx.transaction(savepoint => assertCanMutateCertifiedLineage(ctx, savepoint,
        { entityType: 'feedstock', entityId: fixture.feedstockId }, 'update')));

    await expect(result).resolves.toMatchObject({ kind: 'callback_threw', error: { code: 'certification_locked' } });
    expect(remote.calls).toBe(1);
  }, 'ghgStatement');
});
