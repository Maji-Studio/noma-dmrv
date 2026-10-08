import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  certifierProjects, certifierRemovals, creditBatchApplications,
  creditBatchProductionRuns, creditBatches, facilities, feedstocks,
  feedstockTypes, productionProcesses, productionRunFeedstockDraws,
  productionRunFeedstocks, productionRuns, reactors, storageLocations,
} from "@/db/schema";
import { createProductionRun, updateProductionRun } from "@/data-access/production-runs";
import { createRemovalDeletionFixture } from "./helpers/removal-deletion-fixture";
import { createBiocharApplicationChain } from "./helpers/biochar-application-chain";
import { cleanupOutputFixtureParents } from "./helpers/output-contract-fixtures";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

const BARRIER_TIMEOUT_MS = 5_000;
const TEST_TIMEOUT_MS = 20_000;
const FEEDSTOCK_WET_KG = 100;
const FEEDSTOCK_DRY_KG = 80;
const MOISTURE_PERCENT = 20;
const BIOCHAR_WET_KG = 30;
const ctx = makeTestOrgContext();

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function fixture() {
  const tracked = {
    createdFacilityIds: [] as string[], createdRemovalIds: [] as string[],
    createdBatchIds: [] as string[], createdFeedstockTypeIds: [] as string[],
  };
  const f = await createRemovalDeletionFixture(tracked);
  const [reactor] = await db.insert(reactors).values({
    organizationId: TEST_ORG_ID, facilityId: f.facilityId,
    code: `RE-RACE-${f.runId}`, identifier: `Race ${f.runId}`, reactorType: "auger",
  }).returning();
  const [bin] = await db.insert(storageLocations).values({
    organizationId: TEST_ORG_ID, facilityId: f.facilityId,
    feedstockTypeId: tracked.createdFeedstockTypeIds[0],
    code: `BIN-RACE-${f.runId}`, name: `Race ${f.runId}`, type: "feedstock_bin",
  }).returning();
  const [stock] = await db.insert(feedstocks).values({
    organizationId: TEST_ORG_ID, facilityId: f.facilityId,
    feedstockTypeId: tracked.createdFeedstockTypeIds[0], storageLocationId: bin.id,
    code: `FS-RACE-${f.runId}`, status: "complete",
    massDryKg: FEEDSTOCK_DRY_KG, massWetKg: FEEDSTOCK_WET_KG, moistureContentPercent: MOISTURE_PERCENT,
  }).returning();
  const run = await createProductionRun(ctx, {
    code: `PR-RACE-${f.runId}`, facilityId: f.facilityId, reactorId: reactor.id,
    status: "running", startTime: new Date("2026-01-15T08:00:00Z"), endTime: null,
    feedstockWetMassKg: FEEDSTOCK_WET_KG, feedstockMoisturePercent: MOISTURE_PERCENT,
    feedstockStorageLocationId: bin.id,
  });
  return {
    ...f, run,
    complete: () => updateProductionRun(ctx, run.id, {
      expectedVersion: run.version, status: "complete",
      endTime: new Date("2026-01-15T12:00:00Z"),
      biocharOutputKg: BIOCHAR_WET_KG, biocharMoisturePercent: MOISTURE_PERCENT,
    }),
    cleanup: async () => {
      await db.delete(creditBatchApplications).where(eq(creditBatchApplications.creditBatchId, f.creditBatchId));
      await db.delete(creditBatchProductionRuns).where(eq(creditBatchProductionRuns.creditBatchId, f.creditBatchId));
      await db.delete(productionRunFeedstockDraws).where(eq(productionRunFeedstockDraws.productionRunId, run.id));
      await db.delete(productionRunFeedstocks).where(eq(productionRunFeedstocks.productionRunId, run.id));
      await db.delete(productionRuns).where(eq(productionRuns.id, run.id));
      await db.delete(creditBatches).where(eq(creditBatches.id, f.creditBatchId));
      await db.delete(certifierRemovals).where(eq(certifierRemovals.id, f.removalId));
      await db.delete(certifierProjects).where(eq(certifierProjects.id, f.certifierProjectId));
      await db.delete(productionProcesses).where(eq(productionProcesses.facilityId, f.facilityId));
      await db.delete(feedstocks).where(eq(feedstocks.id, stock.id));
      await db.delete(storageLocations).where(eq(storageLocations.id, bin.id));
      await db.delete(reactors).where(eq(reactors.id, reactor.id));
      await cleanupOutputFixtureParents(db, f.facilityId);
      await db.delete(facilities).where(eq(facilities.id, f.facilityId));
      await db.delete(feedstockTypes).where(eq(feedstockTypes.id, tracked.createdFeedstockTypeIds[0]));
    },
  };
}

async function expectCompletedWithoutMembership(runId: string) {
  const [saved] = await db.select().from(productionRuns).where(eq(productionRuns.id, runId));
  expect(saved.status).toBe("complete");
  expect(saved.biocharOutputKg).toBe(BIOCHAR_WET_KG);
  expect(await db.select().from(creditBatchProductionRuns)
    .where(eq(creditBatchProductionRuns.productionRunId, runId))).toEqual([]);
}

beforeAll(() => ensureTestOrg());

describe("production completion tolerates auto-attachment races", () => {
  it("completes unattached when the matching batch leaves the cohort during the row-lock wait", async () => {
    const f = await fixture();
    const ready = deferred();
    const release = deferred();
    let blockerPid = 0;
    const blocker = db.transaction(async (tx) => {
      // Uncommitted move: the unlocked match still sees January. PostgreSQL
      // rechecks the cohort predicate once the FOR UPDATE wait is released.
      await tx.update(creditBatches).set({ startDate: "2026-02-01", endDate: "2026-02-28" })
        .where(eq(creditBatches.id, f.creditBatchId));
      const result = await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      blockerPid = result.rows[0].pid;
      ready.resolve();
      await release.promise;
    });
    let completion: ReturnType<typeof f.complete> | undefined;
    try {
      await Promise.race([ready.promise, blocker]);
      completion = f.complete();
      void completion.catch(() => undefined);
      await expect.poll(async () => {
        const result = await db.execute<{ waiting: boolean }>(sql`
          select exists (
            select 1 from pg_stat_activity
            where ${blockerPid} = any(pg_blocking_pids(pid))
              and query ilike '%credit_batches%' and query ilike '%for update%'
          ) as waiting
        `);
        return result.rows[0].waiting;
      }, { timeout: BARRIER_TIMEOUT_MS }).toBe(true);
      release.resolve();
      await blocker;
      await completion;
      await expectCompletedWithoutMembership(f.run.id);
    } finally {
      release.resolve();
      await blocker.catch(() => undefined);
      await completion?.catch(() => undefined);
      await f.cleanup();
    }
  }, TEST_TIMEOUT_MS);

  it("completes unattached while a linked Removal row remains locked", async () => {
    const f = await fixture();
    const chain = await createBiocharApplicationChain({ ...f, tag: `RACE-${f.runId}` });
    await db.insert(creditBatchApplications).values({
      organizationId: TEST_ORG_ID, creditBatchId: f.creditBatchId,
      applicationId: chain.applicationId, removalId: f.removalId,
      allocatedWetMassKg: BIOCHAR_WET_KG, allocatedDryMassKg: BIOCHAR_WET_KG,
    });
    const ready = deferred();
    const release = deferred();
    const blocker = db.transaction(async (tx) => {
      await tx.select().from(certifierRemovals)
        .where(eq(certifierRemovals.id, f.removalId)).for("update");
      ready.resolve();
      await release.promise;
    });
    let completion: ReturnType<typeof f.complete> | undefined;
    try {
      await Promise.race([ready.promise, blocker]);
      completion = f.complete();
      let settled = false;
      void completion.then(() => { settled = true; }, () => { settled = true; });
      await expect.poll(() => settled, { timeout: BARRIER_TIMEOUT_MS }).toBe(true);
      await completion;
      // Assert the committed state before releasing the Removal lock.
      await expectCompletedWithoutMembership(f.run.id);
    } finally {
      release.resolve();
      await blocker.catch(() => undefined);
      await completion?.catch(() => undefined);
      await db.delete(creditBatchApplications).where(eq(creditBatchApplications.creditBatchId, f.creditBatchId));
      await chain.cleanup();
      await f.cleanup();
    }
  }, TEST_TIMEOUT_MS);
});
