import { beforeAll, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import {
  applications, biocharProducts, certificationSubmissions, creditBatchApplications,
  creditBatchProductionRuns, creditBatches, deliveries, facilities, feedstocks,
  orders, productionRunFeedstockDraws, productionRunFeedstocks, productionRuns, samples, storageLocations,
} from "@/db/schema";
import { updateProductionRun, createProductionRunInTransaction, deleteProductionRunInTransaction } from "@/data-access/production-runs/mutations";
import { replaceProductionRunFeedstockDraws } from "@/data-access/production-runs/feedstock-draws";
import { attachProductionRunToMatchingCreditBatch } from "@/data-access/credit-batch-membership";
import { createCreditBatchInTransaction, deleteCreditBatch, updateCreditBatch } from "@/data-access/credit-batches";
import { archiveFacility, restoreFacility } from "@/data-access/facilities";
import { getFeedstockTransportOwners } from "@/data-access/feedstock-transport-ownership";
import { prepareFeedstockTransportOwnershipFreeze } from "@/data-access/feedstock-transport-ownership-freeze";
import { reallocateRunsForBins } from "@/data-access/feedstock-run-allocations";
import { lockBinStocks } from "@/data-access/lock-bin-stocks";
import { withLineageFixture, type LineageFixture } from "./helpers/certification-lineage-fixture";
import { deleteOutputApplicationFixtures, deleteOutputDeliveryFixtures, deleteOutputOrderFixtures, deleteOutputProductFixtures } from "./helpers/output-contract-fixtures";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

const EARLY = new Date("2026-06-12T08:00:00Z");
const EARLY_END = new Date("2026-06-12T12:00:00Z");
const LATE = new Date("2026-06-14T08:00:00Z");
const LATE_END = new Date("2026-06-14T12:00:00Z");
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
    await withLineageFixture(async b => {
      await db.update(productionRuns).set({ status: "complete", endTime: new Date("2026-06-13T12:00:00Z") })
        .where(eq(productionRuns.id, b.productionRunId));
      await db.insert(productionRunFeedstocks).values({ organizationId: TEST_ORG_ID,
        productionRunId: b.productionRunId, feedstockId: a.feedstockId, wetMassUsedKg: 1 });
      if (mode !== "unsent-moves") {
        await db.insert(certificationSubmissions).values({ organizationId: TEST_ORG_ID,
          provider: "isometric", submissionType: "removal", localEntityType: "removal",
          localEntityId: b.removalId, version: 1, status: "submitted", submittedAt: ARCHIVE_STAMP,
          externalId: `ext_${b.removalId}`, payloadSnapshot: { transportFeedstockIds: countingSharedFeedstock ? [a.feedstockId, b.feedstockId] : [b.feedstockId] },
        });
      }
      await test(a, b);
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
async function expectFreeze(mode: Mode, write: Promise<unknown>, a: LineageFixture, expectedOwner: string | undefined) {
  if (mode === "sent-moves") {
    const error = await write.then(() => null, (failure: unknown) => failure);
    const [stock] = await db.select().from(feedstocks).where(eq(feedstocks.id, a.feedstockId));
    expect(error).toMatchObject({ code: "certification_locked",
      message: expect.stringContaining(`truck trips of feedstock ${stock.code}`) });
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

it.each(MODES)("explicit membership removal: %s", async mode => {
  await withPair(mode, async (a, b) => {
    if (mode === "sent-stays") await makeNonOwner(a);
    // Shrink the window too, otherwise declaration intentionally auto-expands.
    await expectFreeze(mode, updateCreditBatch(ctx, a.batchId, { expectedVersion: await batchVersion(a),
      productionRunIds: [], startDate: new Date("2026-06-20T00:00:00Z") }),
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

it.each(MODES)("facility archive freezes both run and batch eligibility: %s", async mode => {
  await withPair(mode, async (a, b) => {
    if (mode === "sent-stays") await makeNonOwner(a);
    await expectFreeze(mode, archiveFacility(ctx, a.facilityId, await facilityVersion(a)),
      a, mode === "sent-moves" ? a.productionRunId : b.productionRunId);
  });
});

it.each(MODES)("facility restore freezes both run and batch eligibility: %s", async mode => {
  await withPair(mode, async (a, b) => {
    if (mode === "sent-stays") await makeNonOwner(a);
    // Set up a historical archive before attempting the supported restore path.
    await db.update(facilities).set({ archivedAt: ARCHIVE_STAMP }).where(eq(facilities.id, a.facilityId));
    await db.update(productionRuns).set({ archivedAt: ARCHIVE_STAMP }).where(eq(productionRuns.id, a.productionRunId));
    await db.update(creditBatches).set({ archivedAt: ARCHIVE_STAMP }).where(eq(creditBatches.id, a.batchId));
    await expectFreeze(mode, restoreFacility(ctx, a.facilityId, await facilityVersion(a)),
      a, mode === "unsent-moves" ? a.productionRunId : b.productionRunId);
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

it.each(MODES)("new backdated completed run and automatic attachment: %s", async mode => {
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
        await expect(write).rejects.toMatchObject({ code: "certification_locked", message: expect.stringContaining("truck trips") });
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
  });
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
        startDate: new Date("2026-06-01T00:00:00Z"), endDate: new Date("2026-06-30T00:00:00Z"),
        productionRunIds: [a.productionRunId], sampling: "sampled",
      }, "form"));
      await expectFreeze(mode, write, a, mode === "unsent-moves" ? a.productionRunId : b.productionRunId);
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
      await expectFreeze(mode, db.transaction(async tx => {
        const freeze = await prepareFeedstockTransportOwnershipFreeze(ctx, tx, [a.feedstockId], {
          subject: path === "batch-archive" ? "credit batch" : "production run", mutation: path === "run-status" ? "update" : "archive",
        });
        return freeze(() => write(tx));
      }), a, mode === "sent-moves" ? a.productionRunId : b.productionRunId);
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
