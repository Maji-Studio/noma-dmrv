import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";
/**
 * DB-backed contract for the two outcomes of a credit-batch write (issues
 * #769, #797): the row commits first, and the accounting roll-up that
 * describes it runs afterwards in its own transaction. When that roll-up
 * fails, create and update still answer the committed row, with the roll-up
 * fields null and `previewAvailable: false`, never a thrown failure for a
 * save that landed.
 *
 * Nothing in the data-access layer is mocked: the roll-up's own read-only
 * transaction is made to throw, so the safe loader's catch path runs for real.
 * Requires a running database (DATABASE_URL from .env.test or test defaults).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";

const mocks = vi.hoisted(() => ({
  rollupFailure: null as Error | null,
  loggerError: vi.fn(),
}));

vi.mock("@/lib/log", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/log")>();
  return {
    ...actual,
    logger: { ...actual.logger, error: mocks.loggerError },
  };
});

import { db } from "@/db";

// The roll-up is the only read here that opens a read-only transaction, so
// failing exactly those transactions makes the real safe loader hit its
// catch path while every write still lands.
const realTransaction = db.transaction.bind(db);
function failReadOnlyTransactionsWhenArmed() {
  vi.spyOn(db, "transaction").mockImplementation(((
    ...args: Parameters<typeof db.transaction>
  ) => {
    const config = args[1];
    if (mocks.rollupFailure && config?.accessMode === "read only") {
      throw mocks.rollupFailure;
    }
    return realTransaction(...args);
  }) as typeof db.transaction);
}

import { facilities } from "@/db/schema/facilities";
import { feedstockTypes } from "@/db/schema/feedstock";
import { creditBatches, creditBatchProductionRuns } from "@/db/schema/credits";
import { productionProcesses } from "@/db/schema/production-processes";
import {
  createCreditBatch,
  updateCreditBatch,
} from "@/data-access/credit-batches";

const ctx = makeTestOrgContext();
const createdBatchIds: string[] = [];
let facilityId: string;
let feedstockTypeId: string;

const H_TO_CORG_BEFORE = 0.4;
const H_TO_CORG_AFTER = 0.5;

function monthWindow(month: string) {
  const startDate = new Date(`${month}-01T00:00:00.000Z`);
  const endDate = new Date(
    Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 0),
  );
  return { startDate, endDate };
}

async function makeBatch(month: string, code: string) {
  const batch = await createCreditBatch(ctx, {
    ...monthWindow(month),
    code,
    facilityId,
    feedstockTypeId,
    productionRunIds: [],
    hToCorgRatio: H_TO_CORG_BEFORE,
    currency: "TZS",
  });
  createdBatchIds.push(batch.id);
  return batch;
}

async function storedRatio(id: string): Promise<number | null> {
  const [row] = await db
    .select({ hToCorgRatio: creditBatches.hToCorgRatio })
    .from(creditBatches)
    .where(eq(creditBatches.id, id));
  return row?.hToCorgRatio == null ? null : Number(row.hToCorgRatio);
}

beforeAll(async () => {
  await ensureTestOrg();
  const runId = Date.now().toString(36);
  const [facility] = await db
    .insert(facilities)
    .values({
      organizationId: TEST_ORG_ID,
      name: `Saved-Outcome Facility ${runId}`,
      code: `FAC-SO-${runId}`,
      durabilityOption: "200_year",
    })
    .returning({ id: facilities.id });
  facilityId = facility.id;
  const [feedstockType] = await db
    .insert(feedstockTypes)
    .values({
      organizationId: TEST_ORG_ID,
      name: `Saved-Outcome Woodchips ${runId}`,
      code: `FT-SO-${runId}`,
      category: "forestry",
    })
    .returning({ id: feedstockTypes.id });
  feedstockTypeId = feedstockType.id;
});

beforeEach(() => {
  mocks.rollupFailure = null;
  mocks.loggerError.mockClear();
  // Installed per test: the vitest config restores spies between tests.
  failReadOnlyTransactionsWhenArmed();
});

afterAll(async () => {
  mocks.rollupFailure = null;
  await db.transaction(async (tx) => {
    if (createdBatchIds.length > 0) {
      await tx
        .delete(creditBatchProductionRuns)
        .where(inArray(creditBatchProductionRuns.creditBatchId, createdBatchIds));
      await tx.delete(creditBatches).where(inArray(creditBatches.id, createdBatchIds));
    }
    await tx
      .delete(productionProcesses)
      .where(eq(productionProcesses.facilityId, facilityId));
    await tx.delete(feedstockTypes).where(eq(feedstockTypes.id, feedstockTypeId));
    await tx.delete(facilities).where(eq(facilities.id, facilityId));
  });
});

describe("credit batch writes describe what they committed", () => {
  it("create answers the committed row with its roll-up when the roll-up loads", async () => {
    const batch = await makeBatch("2025-01", `CB-SO-CREATE-OK-${Date.now()}`);

    expect(batch.previewAvailable).toBe(true);
    expect(batch.appliedWeightTons).toBe(0);
    expect(batch.applicationIds).toEqual([]);
    expect(await storedRatio(batch.id)).toBe(H_TO_CORG_BEFORE);
  });

  it("create still answers the committed row when the roll-up does not load", async () => {
    mocks.rollupFailure = new Error("roll-up unavailable");

    const batch = await makeBatch("2025-02", `CB-SO-CREATE-NOROLLUP-${Date.now()}`);

    expect(batch.previewAvailable).toBe(false);
    expect(batch.appliedWeightTons).toBeNull();
    expect(batch.applicationIds).toBeNull();
    expect(batch.applicationCount).toBeNull();
    expect(batch.productionRunIds).toEqual([]);
    expect(await storedRatio(batch.id)).toBe(H_TO_CORG_BEFORE);
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ creditBatchId: batch.id }),
      "credit batch accounting could not be loaded after a committed write",
    );
  });

  it("update answers the committed row with its roll-up when the roll-up loads", async () => {
    const batch = await makeBatch("2025-03", `CB-SO-UPDATE-OK-${Date.now()}`);

    const updated = await updateCreditBatch(ctx, batch.id, {
      hToCorgRatio: H_TO_CORG_AFTER,
    });

    expect(updated.previewAvailable).toBe(true);
    expect(Number(updated.hToCorgRatio)).toBe(H_TO_CORG_AFTER);
    expect(updated.facility?.name).toContain("Saved-Outcome Facility");
    expect(updated.feedstockTypeName).toContain("Saved-Outcome Woodchips");
    expect(await storedRatio(batch.id)).toBe(H_TO_CORG_AFTER);
  });

  it("update still answers the committed row when the roll-up does not load (issue #797)", async () => {
    const batch = await makeBatch("2025-04", `CB-SO-UPDATE-NOROLLUP-${Date.now()}`);
    mocks.rollupFailure = new Error("roll-up unavailable");

    const updated = await updateCreditBatch(ctx, batch.id, {
      hToCorgRatio: H_TO_CORG_AFTER,
    });

    // The save landed and is described as such; only the roll-up is unknown.
    expect(updated.id).toBe(batch.id);
    expect(updated.previewAvailable).toBe(false);
    expect(Number(updated.hToCorgRatio)).toBe(H_TO_CORG_AFTER);
    expect(updated.appliedWeightTons).toBeNull();
    expect(updated.applicationIds).toBeNull();
    expect(updated.co2eStoredPreview).toBeNull();
    expect(updated.productionRunIds).toEqual([]);
    expect(await storedRatio(batch.id)).toBe(H_TO_CORG_AFTER);
    expect(mocks.loggerError).toHaveBeenCalledWith(
      expect.objectContaining({ creditBatchId: batch.id }),
      "credit batch accounting could not be loaded after a committed write",
    );
  });
});
