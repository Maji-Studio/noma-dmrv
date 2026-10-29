import { beforeAll, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import {
  applications, biocharProducts, certificationSubmissions, creditBatchApplications,
  creditBatchProductionRuns, creditBatches, certifierRemovals, deliveries, facilities, feedstocks, reactors,
  orders, productionRunFeedstockDraws, productionRunFeedstocks, productionRuns, samples, storageLocations,
} from "@/db/schema";
import { updateProductionRun, createProductionRunInTransaction, deleteProductionRunInTransaction } from "@/data-access/production-runs/mutations";
import { replaceProductionRunFeedstockDraws } from "@/data-access/production-runs/feedstock-draws";
import { attachProductionRunToMatchingCreditBatch } from "@/data-access/credit-batch-membership";
import { createCreditBatchInTransaction, deleteCreditBatch, updateCreditBatch } from "@/data-access/credit-batches";
import { updateFeedstockInTransaction } from "@/data-access/feedstocks";
import { archiveFacility, restoreFacility } from "@/data-access/facilities";
import { getFeedstockTransportOwners } from "@/data-access/feedstock-transport-ownership";
import { prepareFeedstockTransportOwnershipFreeze } from "@/data-access/feedstock-transport-ownership-freeze";
import { reallocateRunsForBins } from "@/data-access/feedstock-run-allocations";
import { acquireCertificationArtifactLocksSorted } from "@/lib/certification/submission-lock";
import { lockBinStocks } from "@/data-access/lock-bin-stocks";
import { openOperationBarrier, waitForBlockedOperations } from "./helpers/operation-barrier";
import { withLineageFixture, type LineageFixture } from "./helpers/certification-lineage-fixture";
import { deleteOutputApplicationFixtures, deleteOutputDeliveryFixtures, deleteOutputOrderFixtures, deleteOutputProductFixtures } from "./helpers/output-contract-fixtures";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

const EARLY = new Date("2026-06-12T08:00:00Z");
const EARLY_END = new Date("2026-06-12T12:00:00Z");
const LATE = new Date("2026-06-14T08:00:00Z");
const LATE_END = new Date("2026-06-14T12:00:00Z");
const RACE_LATE = new Date("2026-06-15T08:00:00Z");
const ARCHIVE_STAMP = new Date("2026-06-18T00:00:00Z");
const ctx = makeTestOrgContext();
const MODES = ["sent-moves", "unsent-moves", "sent-stays"] as const;
type Mode = typeof MODES[number];

beforeAll(() => ensureTestOrg());

/** A has no independent output or Removal dependency; only B is sent. */
async function withPair(mode: Mode, test: (a: LineageFixture, b: LineageFixture) => Promise<void>, countingSharedFeedstock = false) {
  await withLineageFixture(async a => {
    await db.transaction(async tx => {
      await tx.delete(creditBatchApplications).where(eq(creditBatchApplications.creditBatchId, a.batchId));
      await tx.delete(samples).where(eq(samples.id, a.sampleId));
      await deleteOutputApplicationFixtures(tx, eq(applications.id, a.applicationId));
      await deleteOutputDeliveryFixtures(tx, eq(deliveries.id, a.deliveryId));
      await deleteOutputOrderFixtures(tx, eq(orders.id, a.orderId));
      await deleteOutputProductFixtures(tx, eq(biocharProducts.id, a.productId));
      await tx.update(productionRuns).set({ status: "complete", startTime: EARLY, endTime: EARLY_END })
        .where(eq(productionRuns.id, a.productionRunId));
    });
    await db.update(creditBatches).set({ endDate: "2026-06-15" }).where(eq(creditBatches.id, a.batchId));
    await db.update(feedstocks).set({ massWetKg: 2_000, massDryKg: 1_800 }).where(eq(feedstocks.id, a.feedstockId));
    await withLineageFixture(async b => {
      // Both runs draw the shared bin in one facility. Batch windows use end
      // dates, so B can start between A's old/new dates without cohort overlap.
      await db.transaction(async tx => {
        // Keep facility-scoped names unique when merging the two fixtures.
        await tx.update(reactors).set({ facilityId: a.facilityId,
          identifier: sql`${reactors.identifier} || ' ' || ${reactors.id}` }).where(eq(reactors.id, b.reactorId));
        await tx.update(storageLocations).set({ facilityId: a.facilityId,
          name: sql`${storageLocations.name} || ' ' || ${storageLocations.id}` }).where(eq(storageLocations.facilityId, b.facilityId));
        await tx.update(storageLocations).set({ feedstockTypeId: a.feedstockTypeId }).where(eq(storageLocations.id, b.feedstockBinId));
        await tx.update(feedstocks).set({ facilityId: a.facilityId, feedstockTypeId: a.feedstockTypeId }).where(eq(feedstocks.id, b.feedstockId));
        await tx.update(productionRuns).set({ facilityId: a.facilityId, status: "complete",
          feedstockWetMassKg: 1_001, feedstockMassDryKg: 900.9, endTime: new Date("2026-06-16T12:00:00Z") })
          .where(eq(productionRuns.id, b.productionRunId));
        await tx.insert(productionRunFeedstockDraws).values({ organizationId: TEST_ORG_ID,
          productionRunId: b.productionRunId, storageLocationId: a.feedstockBinId, wetMassKg: 1 });
        await tx.update(creditBatches).set({ facilityId: a.facilityId, feedstockTypeId: a.feedstockTypeId,
          productionProcessId: a.productionProcessId, startDate: "2026-06-16" }).where(eq(creditBatches.id, b.batchId));
        await tx.update(certifierRemovals).set({ facilityId: a.facilityId }).where(eq(certifierRemovals.id, b.removalId));
        await tx.update(biocharProducts).set({ facilityId: a.facilityId }).where(eq(biocharProducts.id, b.productId));
        await tx.update(orders).set({ facilityId: a.facilityId }).where(eq(orders.id, b.orderId));
        await tx.update(deliveries).set({ facilityId: a.facilityId }).where(eq(deliveries.id, b.deliveryId));
      });
      await db.insert(productionRunFeedstocks).values({ organizationId: TEST_ORG_ID,
        productionRunId: b.productionRunId, feedstockId: a.feedstockId, wetMassUsedKg: 1 });
      if (mode !== "unsent-moves") {
        await db.insert(certificationSubmissions).values({ organizationId: TEST_ORG_ID,
          provider: "isometric", submissionType: "removal", localEntityType: "removal",
          localEntityId: b.removalId, version: 1, status: "submitted", submittedAt: ARCHIVE_STAMP,
          externalId: `ext_${b.removalId}`, payloadSnapshot: { transportFeedstockIds: countingSharedFeedstock ? [a.feedstockId, b.feedstockId] : [b.feedstockId] },
        });
      }
      await test(a, { ...b, facilityId: a.facilityId, feedstockTypeId: a.feedstockTypeId });
    }, "none");
  }, "none");
}

async function owner(a: LineageFixture) {
  return (await getFeedstockTransportOwners(ctx, [a.feedstockId])).get(a.feedstockId);
}
async function runVersion(a: LineageFixture) {
  const [row] = await db.select().from(productionRuns).where(eq(productionRuns.id, a.productionRunId));
  return row.version;
}
async function batchVersion(a: LineageFixture) {
  const [row] = await db.select().from(creditBatches).where(eq(creditBatches.id, a.batchId));
  return row.version;
}
async function facilityVersion(a: LineageFixture) {
  const [row] = await db.select().from(facilities).where(eq(facilities.id, a.facilityId));
  return row.version;
}
async function expectFreeze(mode: Mode, write: Promise<unknown>, a: LineageFixture, expectedOwner: string | undefined, refusalPrefix?: string) {
  if (mode === "sent-moves") {
    const error = await write.then(() => null, (failure: unknown) => failure);
    const [stock] = await db.select().from(feedstocks).where(eq(feedstocks.id, a.feedstockId));
    expect(error).toMatchObject({ code: "certification_locked",
      message: expect.stringContaining(`transport legs of feedstock ${stock.code}, and a Removal that uses this feedstock is already sent.`) });
    if (refusalPrefix) expect(error).toMatchObject({ message: expect.stringContaining(refusalPrefix) });
  } else {
    await write;
  }
  expect(await owner(a)).toBe(expectedOwner);
}
async function makeNonOwner(a: LineageFixture) {
  await db.update(productionRuns).set({ startTime: LATE, endTime: LATE_END }).where(eq(productionRuns.id, a.productionRunId));
}
async function removeMembership(a: LineageFixture) {
  await db.delete(creditBatchProductionRuns).where(eq(creditBatchProductionRuns.productionRunId, a.productionRunId));
}

it.each(MODES)("run date edit: %s (zero-counting Removal and rollback)", async mode => {
  await withPair(mode, async (a, b) => {
    const startTime = mode === "sent-stays" ? new Date("2026-06-12T09:00:00Z") : LATE;
    const endTime = mode === "sent-stays" ? EARLY_END : LATE_END;
    const version = await runVersion(a);
    await expectFreeze(mode, updateProductionRun(ctx, a.productionRunId, { expectedVersion: version, startTime, endTime }),
      a, mode === "unsent-moves" ? b.productionRunId : a.productionRunId);
    if (mode === "sent-moves") {
      const [row] = await db.select().from(productionRuns).where(eq(productionRuns.id, a.productionRunId));
      expect(row.startTime).toEqual(EARLY);
      expect(row.version).toBe(version);
    }
  });
});

it.each(MODES)("completion cannot take transport from a counting run: %s", async mode => {
  await withPair(mode, async (a, b) => {
    if (mode === "sent-stays") await makeNonOwner(a);
    await db.update(productionRuns).set({ status: "running", endTime: null }).where(eq(productionRuns.id, a.productionRunId));
    await expectFreeze(mode, updateProductionRun(ctx, a.productionRunId, {
      expectedVersion: await runVersion(a), status: "complete", endTime: mode === "sent-stays" ? LATE_END : EARLY_END,
    }), a, mode === "unsent-moves" ? a.productionRunId : b.productionRunId);
  });
});

it.each(MODES)("draw removal: %s", async mode => {
  await withPair(mode, async (a, b) => {
    if (mode === "sent-stays") await makeNonOwner(a);
    await expectFreeze(mode, db.transaction(async tx => {
      await lockBinStocks(ctx, tx, [a.feedstockBinId]);
      return replaceProductionRunFeedstockDraws(ctx, tx, { productionRunId: a.productionRunId, facilityId: a.facilityId, draws: [] });
    }), a, mode === "sent-moves" ? a.productionRunId : b.productionRunId);
  });
});

it.each(MODES)("draw addition: %s", async mode => {
  await withPair(mode, async (a, b) => {
    if (mode === "sent-stays") await makeNonOwner(a);
    await db.delete(productionRunFeedstocks).where(eq(productionRunFeedstocks.productionRunId, a.productionRunId));
    await db.delete(productionRunFeedstockDraws).where(eq(productionRunFeedstockDraws.productionRunId, a.productionRunId));
    await expectFreeze(mode, db.transaction(async tx => {
      await lockBinStocks(ctx, tx, [a.feedstockBinId]);
      return replaceProductionRunFeedstockDraws(ctx, tx, { productionRunId: a.productionRunId, facilityId: a.facilityId,
        draws: [{ storageLocationId: a.feedstockBinId, wetMassKg: 500 }] });
    }), a, mode === "unsent-moves" ? a.productionRunId : b.productionRunId);
  });
});

it.each(MODES)("provenance reallocation removes the old feedstock id: %s", async mode => {
  await withPair(mode, async (a, b) => {
    if (mode === "sent-stays") await makeNonOwner(a);
    // A corrected intake date changes the allocation to a different record.
    const [stock] = await db.select().from(feedstocks).where(eq(feedstocks.id, a.feedstockId));
    const replacementId = crypto.randomUUID();
    await db.insert(feedstocks).values({ ...stock, id: replacementId, code: `E2E-FREEZE-${replacementId}` });
    await db.update(feedstocks).set({ deliveryDate: new Date("2027-01-01T00:00:00Z") }).where(eq(feedstocks.id, a.feedstockId));
    try {
      await expectFreeze(mode, db.transaction(tx => reallocateRunsForBins(ctx, tx, [a.feedstockBinId], { onlyRunId: a.productionRunId })),
        a, mode === "sent-moves" ? a.productionRunId : b.productionRunId);
    } finally {
      await db.delete(productionRunFeedstocks).where(eq(productionRunFeedstocks.feedstockId, replacementId));
      await db.delete(feedstocks).where(eq(feedstocks.id, replacementId));
    }
  });
});

it("refuses a shared intake delivery-date edit that would move a Sent transport owner", async () => {
  await withPair("sent-moves", async a => {
    const [stock] = await db.select().from(feedstocks).where(eq(feedstocks.id, a.feedstockId));
    const replacementId = crypto.randomUUID();
    // The replacement covers A's draw when the shared intake moves to B's day.
    await db.insert(feedstocks).values({ ...stock, id: replacementId, code: `E2E-FREEZE-${replacementId}` });
    try {
      expect(await owner(a)).toBe(a.productionRunId);
      await expect(db.transaction(tx => updateFeedstockInTransaction(ctx, tx, a.feedstockId, {
        expectedVersion: stock.version, deliveryDate: new Date("2026-06-13T00:00:00Z"),
      }))).rejects.toMatchObject({
        code: "certification_locked",
        message: expect.stringContaining("feedstock"),
        issues: expect.arrayContaining([expect.objectContaining({ path: ["deliveryDate"], code: "certification_locked" })]),
      });
      expect(await owner(a)).toBe(a.productionRunId);
      const [saved] = await db.select().from(feedstocks).where(eq(feedstocks.id, a.feedstockId));
      expect(saved.deliveryDate).toEqual(stock.deliveryDate);
      expect(saved.version).toBe(stock.version);
    } finally {
      await db.delete(productionRunFeedstocks).where(eq(productionRunFeedstocks.feedstockId, replacementId));
      await db.delete(feedstocks).where(eq(feedstocks.id, replacementId));
    }
  });
});

it.each(MODES)("explicit membership removal: %s", async mode => {
  await withPair(mode, async (a, b) => {
    if (mode === "sent-stays") await makeNonOwner(a);
    // Shrink the window too, otherwise declaration intentionally auto-expands.
    await expectFreeze(mode, updateCreditBatch(ctx, a.batchId, { expectedVersion: await batchVersion(a),
      productionRunIds: [], startDate: new Date("2026-06-15T00:00:00Z") }),
    a, mode === "sent-moves" ? a.productionRunId : b.productionRunId);
  });
});

it.each(MODES)("explicit membership addition: %s", async mode => {
  await withPair(mode, async (a, b) => {
    if (mode === "sent-stays") await makeNonOwner(a);
    await removeMembership(a);
    await expectFreeze(mode, updateCreditBatch(ctx, a.batchId, { expectedVersion: await batchVersion(a), productionRunIds: [a.productionRunId] }),
      a, mode === "unsent-moves" ? a.productionRunId : b.productionRunId);
  });
});

it.each(MODES)("automatic membership attachment: %s", async mode => {
  await withPair(mode, async (a, b) => {
    if (mode === "sent-stays") await makeNonOwner(a);
    await removeMembership(a);
    await db.update(creditBatches).set({ certifier: null }).where(eq(creditBatches.id, a.batchId));
    await expectFreeze(mode, db.transaction(tx => attachProductionRunToMatchingCreditBatch(ctx, tx, a.productionRunId)),
      a, mode === "unsent-moves" ? a.productionRunId : b.productionRunId);
  });
});

it.each(MODES)("credit batch deletion: %s", async mode => {
  await withPair(mode, async (a, b) => {
    if (mode === "sent-stays") await makeNonOwner(a);
    await expectFreeze(mode, deleteCreditBatch(ctx, a.batchId, await batchVersion(a)),
      a, mode === "sent-moves" ? a.productionRunId : b.productionRunId);
  });
});

it.each(MODES)("single-facility archive and restore retain transport ownership: %s", async mode => {
  await withPair(mode, async (a, b) => {
    if (mode === "sent-stays") await makeNonOwner(a);
    const expectedOwner = mode === "sent-stays" ? b.productionRunId : a.productionRunId;
    expect(await owner(a)).toBe(expectedOwner);
    await archiveFacility(ctx, a.facilityId, await facilityVersion(a));
    expect(await owner(a)).toBeUndefined();
    expect((await getFeedstockTransportOwners(ctx, [a.feedstockId], db, { includeArchived: true })).get(a.feedstockId)).toBe(expectedOwner);
    await restoreFacility(ctx, a.facilityId, await facilityVersion(a));
    expect(await owner(a)).toBe(expectedOwner);
    expect((await getFeedstockTransportOwners(ctx, [a.feedstockId], db, { includeArchived: true })).get(a.feedstockId)).toBe(expectedOwner);
  });
});

it.each(MODES)("backdating an existing run before the sent counting run: %s", async mode => {
  await withPair(mode, async (a, b) => {
    await makeNonOwner(a);
    await expectFreeze(mode, updateProductionRun(ctx, a.productionRunId, {
      expectedVersion: await runVersion(a),
      startTime: mode === "sent-stays" ? new Date("2026-06-14T09:00:00Z") : EARLY,
      endTime: mode === "sent-stays" ? LATE_END : EARLY_END,
    }), a, mode === "unsent-moves" ? a.productionRunId : b.productionRunId);
  }, true);
});

it.each(MODES.flatMap(mode => [false, true].map(counting => ({ mode, counting }))))(
  "new backdated completed run and automatic attachment: $mode, counting=$counting", async ({ mode, counting }) => {
  await withPair(mode, async (a, b) => {
    await removeMembership(a);
    await db.update(productionRuns).set({ status: "cancelled", cancellationReason: "E2E replacement", endTime: null })
      .where(eq(productionRuns.id, a.productionRunId));
    await db.delete(productionRunFeedstockDraws).where(eq(productionRunFeedstockDraws.productionRunId, a.productionRunId));
    await db.delete(productionRunFeedstocks).where(eq(productionRunFeedstocks.productionRunId, a.productionRunId));
    await db.update(creditBatches).set({ certifier: null }).where(eq(creditBatches.id, a.batchId));
    const code = `E2E-FREEZE-${crypto.randomUUID()}`;
    try {
      const write = db.transaction(tx => createProductionRunInTransaction(ctx, tx, {
        code, facilityId: a.facilityId, reactorId: a.reactorId, status: "complete",
        startTime: mode === "sent-stays" ? LATE : EARLY,
        endTime: mode === "sent-stays" ? LATE_END : EARLY_END,
        feedstockDraws: [{ storageLocationId: a.feedstockBinId, wetMassKg: 500 }],
        feedstockMoisturePercent: 10, biocharStorageLocationId: a.biocharBinId,
        biocharOutputKg: 100, biocharMoisturePercent: 5,
      }));
      if (mode === "sent-moves") {
        await expect(write).rejects.toMatchObject({ code: "certification_locked", message: expect.stringContaining("Cannot create this production run because it would change which credit batch counts the transport legs") });
        expect(await owner(a)).toBe(b.productionRunId);
      } else {
        const created = await write;
        expect(await owner(a)).toBe(mode === "unsent-moves" ? created.id : b.productionRunId);
      }
    } finally {
      const rows = await db.select().from(productionRuns).where(and(eq(productionRuns.organizationId, TEST_ORG_ID), eq(productionRuns.code, code)));
      for (const row of rows) {
        await db.delete(creditBatchProductionRuns).where(eq(creditBatchProductionRuns.productionRunId, row.id));
        await db.delete(productionRunFeedstocks).where(eq(productionRunFeedstocks.productionRunId, row.id));
        await db.delete(productionRunFeedstockDraws).where(eq(productionRunFeedstockDraws.productionRunId, row.id));
        await db.delete(productionRuns).where(eq(productionRuns.id, row.id));
      }
    }
  }, counting);
});

it.each(MODES)("new credit batch membership: %s", async mode => {
  await withPair(mode, async (a, b) => {
    if (mode === "sent-stays") await makeNonOwner(a);
    await removeMembership(a);
    await db.delete(creditBatches).where(eq(creditBatches.id, a.batchId));
    const code = `E2E-FREEZE-${crypto.randomUUID()}`;
    try {
      const write = db.transaction(tx => createCreditBatchInTransaction(ctx, tx, {
        code, facilityId: a.facilityId, feedstockTypeId: a.feedstockTypeId,
        startDate: new Date("2026-06-01T00:00:00Z"), endDate: new Date("2026-06-15T00:00:00Z"),
        productionRunIds: [a.productionRunId], sampling: "sampled",
      }, "form"));
      await expectFreeze(mode, write, a, mode === "unsent-moves" ? a.productionRunId : b.productionRunId, "Cannot create this credit batch because");
    } finally {
      const batches = await db.select().from(creditBatches).where(and(eq(creditBatches.organizationId, TEST_ORG_ID), eq(creditBatches.code, code)));
      for (const batch of batches) {
        await db.delete(creditBatchProductionRuns).where(eq(creditBatchProductionRuns.creditBatchId, batch.id));
        await db.delete(creditBatchApplications).where(eq(creditBatchApplications.creditBatchId, batch.id));
        await db.delete(creditBatches).where(eq(creditBatches.id, batch.id));
      }
    }
  });
});

it("keeps the existing batched-run delete and reopen guards, and allows both once unbatched", async () => {
  await withPair("sent-moves", async (a, b) => {
    await expect(db.transaction(tx => deleteProductionRunInTransaction(ctx, tx, a.productionRunId, 1, "form")))
      .rejects.toThrow("credit batches");
    await expect(updateProductionRun(ctx, a.productionRunId, { expectedVersion: 1, status: "running", endTime: null }))
      .rejects.toThrow("Remove this run from its credit batch before reopening it");
    // Fixture setup: an unbatched run cannot own transport. The freeze must
    // not prohibit either operation merely because another run sent this F.
    await removeMembership(a);
    await updateProductionRun(ctx, a.productionRunId, { expectedVersion: 1, status: "running", endTime: null });
    expect(await owner(a)).toBe(b.productionRunId);
    await db.transaction(tx => deleteProductionRunInTransaction(ctx, tx, a.productionRunId, 2, "form"));
    expect(await owner(a)).toBe(b.productionRunId);
  });
});

// There are no individual run/batch archive endpoints. Exercise the shared
// transaction guard for each eligibility input separately as well as the
// supported facility cascades above.
const ELIGIBILITY_WRITES = ["run-archive", "batch-archive", "run-status"] as const;
it.each(ELIGIBILITY_WRITES.flatMap(path => MODES.map(mode => ({ path, mode }))))(
  "$path ownership comparison: $mode", async ({ path, mode }) => {
    await withPair(mode, async (a, b) => {
      if (mode === "sent-stays") await makeNonOwner(a);
      const write = (tx: DbTransaction) => path === "batch-archive"
        ? tx.update(creditBatches).set({ archivedAt: ARCHIVE_STAMP }).where(eq(creditBatches.id, a.batchId)).then(() => undefined)
        : tx.update(productionRuns).set(path === "run-archive" ? { archivedAt: ARCHIVE_STAMP } : { status: "running", endTime: null })
          .where(eq(productionRuns.id, a.productionRunId)).then(() => undefined);
      await expectFreeze(path === "run-status" ? mode : "sent-stays", db.transaction(async tx => {
        const freeze = await prepareFeedstockTransportOwnershipFreeze(ctx, tx, [a.feedstockId], {
          subject: path === "batch-archive" ? "credit batch" : "production run", mutation: path === "run-status" ? "update" : "archive",
        });
        return freeze(() => write(tx));
      }), a, path === "run-status" && mode === "sent-moves" ? a.productionRunId : b.productionRunId);
    });
  },
);

it("compares the final owner, allowing an atomic write that keeps it", async () => {
  await withPair("sent-moves", async a => {
    await db.transaction(async tx => {
      const freeze = await prepareFeedstockTransportOwnershipFreeze(ctx, tx, [a.feedstockId, a.feedstockId], {
        subject: "production run", mutation: "update",
      });
      await freeze(async () => {
        await tx.update(productionRuns).set({ startTime: LATE, endTime: LATE_END }).where(eq(productionRuns.id, a.productionRunId));
        await tx.update(productionRuns).set({ startTime: EARLY, endTime: EARLY_END }).where(eq(productionRuns.id, a.productionRunId));
      });
    });
    expect(await owner(a)).toBe(a.productionRunId);
  });
});

it.each(MODES)("draw source replacement checks the newly selected feedstock: %s", async mode => {
  await withPair(mode, async (a, b) => {
    if (mode === "sent-stays") await makeNonOwner(a);
    const [stock] = await db.select().from(feedstocks).where(eq(feedstocks.id, a.feedstockId));
    const nextBinId = crypto.randomUUID();
    const nextFeedstockId = crypto.randomUUID();
    await db.insert(storageLocations).values({
      id: nextBinId, organizationId: TEST_ORG_ID, facilityId: a.facilityId,
      code: `E2E-FREEZE-${nextBinId}`, name: `E2E replacement source ${nextBinId}`,
      type: "feedstock_bin", feedstockTypeId: stock.feedstockTypeId,
    });
    await db.insert(feedstocks).values({ ...stock, id: nextFeedstockId, code: `E2E-FREEZE-${nextFeedstockId}`, storageLocationId: nextBinId });
    // Keep the old intake unsent; only the replacement intake is in B's lineage.
    await db.delete(productionRunFeedstocks).where(and(eq(productionRunFeedstocks.productionRunId, b.productionRunId), eq(productionRunFeedstocks.feedstockId, a.feedstockId)));
    await db.insert(productionRunFeedstocks).values({ organizationId: TEST_ORG_ID,
      productionRunId: b.productionRunId, feedstockId: nextFeedstockId, wetMassUsedKg: 1 });
    await db.update(productionRunFeedstockDraws).set({ storageLocationId: nextBinId }).where(and(
      eq(productionRunFeedstockDraws.productionRunId, b.productionRunId),
      eq(productionRunFeedstockDraws.storageLocationId, a.feedstockBinId),
    ));
    try {
      const write = db.transaction(async tx => {
        await lockBinStocks(ctx, tx, [a.feedstockBinId, nextBinId]);
        return replaceProductionRunFeedstockDraws(ctx, tx, { productionRunId: a.productionRunId, facilityId: a.facilityId,
          draws: [{ storageLocationId: nextBinId, wetMassKg: 500 }] });
      });
      if (mode === "sent-moves") {
        await expect(write).rejects.toMatchObject({ code: "certification_locked",
          message: expect.stringContaining(`E2E-FREEZE-${nextFeedstockId}`) });
      } else {
        await write;
      }
      const owners = await getFeedstockTransportOwners(ctx, [nextFeedstockId]);
      expect(owners.get(nextFeedstockId)).toBe(mode === "unsent-moves" ? a.productionRunId : b.productionRunId);
      const draws = await db.select().from(productionRunFeedstockDraws).where(eq(productionRunFeedstockDraws.productionRunId, a.productionRunId));
      expect(draws.map(draw => draw.storageLocationId)).toEqual([mode === "sent-moves" ? a.feedstockBinId : nextBinId]);
    } finally {
      await db.delete(productionRunFeedstocks).where(eq(productionRunFeedstocks.feedstockId, nextFeedstockId));
      await db.delete(productionRunFeedstockDraws).where(eq(productionRunFeedstockDraws.storageLocationId, nextBinId));
      await db.delete(feedstocks).where(eq(feedstocks.id, nextFeedstockId));
      await db.delete(storageLocations).where(eq(storageLocations.id, nextBinId));
    }
  });
});

it("refuses replacing a Sent run's draws with none before its last feedstock link disappears", async () => {
  await withPair("sent-moves", async (a, b) => {
    await makeNonOwner(a);
    const before = await db.select().from(productionRunFeedstocks).where(eq(productionRunFeedstocks.productionRunId, b.productionRunId));
    // The public update rejects a complete run with no feedstock in preflight.
    await expect(updateProductionRun(ctx, b.productionRunId, {
      expectedVersion: await runVersion(b), feedstockDraws: [],
    })).rejects.toMatchObject({ code: "validation_failed" });
    // Standalone replacement has no outer run guard. Preserve B's batch target
    // so removing its last link cannot hide its Sent Removal from the freeze.
    await expect(db.transaction(async tx => {
      await lockBinStocks(ctx, tx, [a.feedstockBinId, b.feedstockBinId]);
      return replaceProductionRunFeedstockDraws(ctx, tx, {
        productionRunId: b.productionRunId, facilityId: a.facilityId, draws: [],
      });
    })).rejects.toMatchObject({ code: "certification_locked" });
    const after = await db.select().from(productionRunFeedstocks).where(eq(productionRunFeedstocks.productionRunId, b.productionRunId));
    expect(after).toEqual(before);
    expect(await owner(a)).toBe(b.productionRunId);
    expect(await runVersion(b)).toBe(1);
  });
});

it("backdates and replaces a source in one production update without moving the final owner", async () => {
  await withPair("sent-moves", async (a, b) => {
    await makeNonOwner(a);
    const [stock] = await db.select().from(feedstocks).where(eq(feedstocks.id, a.feedstockId));
    const nextBinId = crypto.randomUUID();
    const nextFeedstockId = crypto.randomUUID();
    await db.insert(storageLocations).values({ id: nextBinId, organizationId: TEST_ORG_ID,
      facilityId: a.facilityId, code: `E2E-FREEZE-${nextBinId}`, name: "E2E replacement source",
      type: "feedstock_bin", feedstockTypeId: a.feedstockTypeId });
    await db.insert(feedstocks).values({ ...stock, id: nextFeedstockId,
      code: `E2E-FREEZE-${nextFeedstockId}`, storageLocationId: nextBinId });
    try {
      expect(await owner(a)).toBe(b.productionRunId);
      await updateProductionRun(ctx, a.productionRunId, {
        expectedVersion: await runVersion(a), startTime: EARLY, endTime: EARLY_END,
        feedstockDraws: [{ storageLocationId: nextBinId, wetMassKg: 500 }],
      });
      expect(await owner(a)).toBe(b.productionRunId);
      const [saved] = await db.select().from(productionRuns).where(eq(productionRuns.id, a.productionRunId));
      expect(saved.startTime).toEqual(EARLY);
      const draws = await db.select().from(productionRunFeedstockDraws).where(eq(productionRunFeedstockDraws.productionRunId, a.productionRunId));
      expect(draws.map(draw => draw.storageLocationId)).toEqual([nextBinId]);
      expect((await getFeedstockTransportOwners(ctx, [nextFeedstockId])).get(nextFeedstockId)).toBe(a.productionRunId);
    } finally {
      await db.delete(productionRunFeedstocks).where(eq(productionRunFeedstocks.feedstockId, nextFeedstockId));
      await db.delete(productionRunFeedstockDraws).where(eq(productionRunFeedstockDraws.storageLocationId, nextBinId));
      await db.delete(feedstocks).where(eq(feedstocks.id, nextFeedstockId));
      await db.delete(storageLocations).where(eq(storageLocations.id, nextBinId));
    }
  });
});

it.each([false, true])("serializes with a draft Removal artifact only when ownership moves: %s", async moves => {
  await withPair("unsent-moves", async (a, b) => {
    let release!: () => void;
    let acquired!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    const ready = new Promise<void>(resolve => { acquired = resolve; });
    const holder = db.transaction(async tx => {
      await acquireCertificationArtifactLocksSorted(tx, [{
        provider: "isometric", localEntityType: "removal", localEntityId: b.removalId,
      }]);
      acquired();
      await released;
    });
    try {
      await Promise.race([ready, holder]);
      const write = updateProductionRun(ctx, a.productionRunId, {
        expectedVersion: await runVersion(a),
        startTime: moves ? LATE : new Date("2026-06-12T09:00:00Z"),
        endTime: moves ? LATE_END : EARLY_END,
      });
      if (moves) {
        await expect(write).rejects.toMatchObject({ code: "conflict", retryable: true });
      } else {
        await write;
      }
      expect(await owner(a)).toBe(a.productionRunId);
    } finally {
      release();
      await holder;
    }
  });
});

it.each(["delete", "empty"] as const)("refuses %s of an archived owning batch before facility restore", async mutation => {
  await withPair("sent-moves", async a => {
    await archiveFacility(ctx, a.facilityId, await facilityVersion(a));
    const write = mutation === "delete"
      ? deleteCreditBatch(ctx, a.batchId, await batchVersion(a))
      : updateCreditBatch(ctx, a.batchId, { expectedVersion: await batchVersion(a),
        productionRunIds: [], startDate: new Date("2026-06-15T00:00:00Z") });
    await expect(write).rejects.toMatchObject({ code: "certification_locked",
      message: expect.stringContaining("transport legs of feedstock") });
    expect((await getFeedstockTransportOwners(ctx, [a.feedstockId], db, { includeArchived: true })).get(a.feedstockId)).toBe(a.productionRunId);
    await restoreFacility(ctx, a.facilityId, await facilityVersion(a));
    expect(await owner(a)).toBe(a.productionRunId);
  });
});

it("serializes a run-date edit with membership creation for a shared Sent feedstock", async () => {
  await withPair("sent-moves", async (a, b) => {
    await makeNonOwner(a);
    await removeMembership(a);
    await db.update(creditBatches).set({ certifier: null }).where(eq(creditBatches.id, a.batchId));
    expect(await owner(a)).toBe(b.productionRunId);
    const barrier = await openOperationBarrier(db.$client);
    let membership: Promise<unknown> | undefined;
    try {
      const freeze = await prepareFeedstockTransportOwnershipFreeze(ctx, barrier.tx, [a.feedstockId], {
        mutation: "update", subject: "production run",
      });
      // A is unbatched. Moving B after A still leaves B as owner. Attaching
      // A while B retains its old date also leaves B as owner. Together they
      // move ownership to A. The writers change different run rows, so a row
      // lock cannot accidentally serialize this ownership comparison.
      await freeze(async () => {
        await barrier.tx.update(productionRuns).set({ startTime: RACE_LATE })
          .where(and(eq(productionRuns.organizationId, TEST_ORG_ID), eq(productionRuns.id, b.productionRunId)));
      });
      membership = db.transaction(tx => attachProductionRunToMatchingCreditBatch(ctx, tx, a.productionRunId));
      void membership.catch(() => undefined);
      await waitForBlockedOperations(db.$client, barrier.pid, 1);
      await barrier.commit();
      await expect(membership).rejects.toMatchObject({ code: "certification_locked" });
      expect(await owner(a)).toBe(b.productionRunId);
      const [run] = await db.select().from(productionRuns).where(eq(productionRuns.id, b.productionRunId));
      expect(run.startTime).toEqual(RACE_LATE);
      const memberships = await db.select().from(creditBatchProductionRuns)
        .where(eq(creditBatchProductionRuns.productionRunId, a.productionRunId));
      expect(memberships).toEqual([]);
    } finally {
      await barrier.rollback();
      await membership?.catch(() => undefined);
    }
  });
});
