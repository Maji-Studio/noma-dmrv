import { Pool } from "pg";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, type DbTransaction } from "@/db";
import * as schema from "@/db/schema";
import { pgErrorCode, PG_DEADLOCK_DETECTED } from "@/db/errors";
import { updateFacility } from "@/data-access/facility-mutations";
import { archiveFacility } from "@/data-access/facilities";
import { resolveFacilityTimezoneEdit } from "@/data-access/facility-timezone-guard";
import { updateCreditBatch } from "@/data-access/credit-batches";
import { updateProductionRun, updateProductionRunInTransaction } from "@/data-access/production-runs";
import { createSampleInTransaction } from "@/data-access/samples/create";
import { updateSampleInTransaction } from "@/data-access/samples/update";
import { SafeError } from "@/lib/errors";
import { DomainError } from "@/lib/domain-errors";
import { getPgPoolConfig } from "@/lib/pg-pool-config";
import { facilityCalendarFixture } from "./helpers/facility-calendar-fixture";
import { feedstockFixtureValues, cleanupFeedstockFixtureParents } from "./helpers/feedstock-fixture";
import { createProductionRunOutputBin } from "./helpers/production-run-output-bin";
import { openOperationBarrier, waitForBlockedOperations } from "./helpers/operation-barrier";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

const TEST_TIMEOUT_MS = 20_000;
const LOCK_TIMEOUT_MS = 5_000;
const PAUSE_TIMEOUT_MS = 8_000;
const POOL_SIZE = 4;
const ONE_WAITER = 1;
const FEEDSTOCK_WET_KG = 2_500;
const FEEDSTOCK_DRY_KG = 2_000;
const DRAW_WET_KG = 100;
const BIOCHAR_WET_KG = 30;
const MOISTURE_PERCENT = 20;
const SAMPLE_CARBON_PERCENT = 80;
const SAMPLE_DAY = new Date("2025-10-02T09:00:00.000Z");
const OLD_ZONE = "UTC";
const NEW_ZONE = "Africa/Dar_es_Salaam";
const RUN_START = "2025-09-30T18:00:00.000Z";
// October 1 in Dar es Salaam, September 30 in UTC.
const RUN_END = "2025-09-30T22:00:00.000Z";
const SEPTEMBER = { startDate: "2025-09-01", endDate: "2025-09-30" };
const AUGUST = { startDate: "2025-08-01", endDate: "2025-08-31" };
const pool = new Pool({ ...getPgPoolConfig(process.env.DATABASE_URL!), max: POOL_SIZE });
const connectionDb = drizzle(pool, { schema });
const ctx = makeTestOrgContext("facility-timezone-attach-race");
let calendar: ReturnType<typeof facilityCalendarFixture>;
let nextPause: ((tx: DbTransaction) => Promise<void>) | undefined;
let facilityIds: string[];
let runIds: string[];
let sampleIds: string[];

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Transaction barrier timed out")), PAUSE_TIMEOUT_MS);
    })]);
  } finally { clearTimeout(timer); }
}
function outcome<T>(promise: Promise<T>) {
  return promise.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}
type Outcome = Awaited<ReturnType<typeof outcome>>;
function assertNoDeadlock(result: Outcome) {
  if (!result.ok) {
    expect(pgErrorCode(result.error)).not.toBe(PG_DEADLOCK_DETECTED);
    // A database timeout must not masquerade as an allowed business refusal.
    expect(pgErrorCode(result.error)).toBeUndefined();
    expect(result.error instanceof SafeError || result.error instanceof DomainError).toBe(true);
  }
}
function assertConflict(result: Outcome) {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error).toBeInstanceOf(DomainError);
    expect(result.error).toMatchObject({ code: "conflict" });
  }
}
async function setLocalTimeout(tx: DbTransaction) {
  await tx.execute(sql.raw(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT_MS}ms'`));
}
// Exercise the public mutations on real separate connections. Only transaction
// plumbing is wrapped: the full callback runs unchanged, with a local timeout
// and an optional pre-commit pause, as in membership-lock-order's pause hooks.
async function boundedTransaction<T>(work: (tx: DbTransaction) => Promise<T>, config?: Parameters<typeof db.transaction>[1]): Promise<T> {
  const pause = nextPause;
  nextPause = undefined;
  return connectionDb.transaction(async tx => {
    await setLocalTimeout(tx);
    const value = await work(tx);
    if (pause) await pause(tx);
    return value;
  }, config);
}
function pauseNextCommit() {
  const ready = gate();
  const resume = gate();
  const state = { pid: 0 };
  nextPause = async tx => {
    state.pid = (await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows[0].pid;
    ready.release();
    await bounded(resume.promise);
  };
  return {
    resume: resume.release,
    state,
    ready: (write: Promise<Outcome>) => bounded(Promise.race([
      ready.promise,
      write.then(result => { throw result.ok ? new Error("Write finished without pausing") : result.error; }),
    ])),
  };
}
async function barrier() {
  const held = await openOperationBarrier(pool);
  try { await setLocalTimeout(held.tx); return held; }
  catch (error) { await held.rollback(); throw error; }
}
async function waitForFacilityLock(blockerPid: number, strength: "update" | "share") {
  const [pid] = await waitForBlockedOperations(pool, blockerPid, ONE_WAITER);
  const { rows } = await pool.query<{ query: string }>(
    "select query from pg_stat_activity where pid = $1 and datname = current_database()", [pid],
  );
  expect(rows[0]?.query).toContain('from "facilities"');
  expect(rows[0]?.query).toContain(`for ${strength}`);
}
async function lockFacility(tx: DbTransaction, id: string, strength: "update" | "share" | "key share") {
  return tx.select().from(schema.facilities).where(and(
    eq(schema.facilities.id, id), eq(schema.facilities.organizationId, TEST_ORG_ID),
  )).for(strength);
}

beforeAll(() => ensureTestOrg());
beforeEach(() => {
  calendar = facilityCalendarFixture("ATTACH-RACE");
  facilityIds = [];
  runIds = [];
  sampleIds = [];
  nextPause = undefined;
  vi.spyOn(db, "transaction").mockImplementation(boundedTransaction);
});
afterEach(async () => {
  vi.restoreAllMocks();
  nextPause = undefined;
  if (sampleIds.length) await db.delete(schema.samples).where(and(eq(schema.samples.organizationId, TEST_ORG_ID), inArray(schema.samples.id, sampleIds)));
  if (runIds.length) {
    await db.delete(schema.creditBatchProductionRuns).where(and(eq(schema.creditBatchProductionRuns.organizationId, TEST_ORG_ID), inArray(schema.creditBatchProductionRuns.productionRunId, runIds)));
    await db.delete(schema.productionRunFeedstocks).where(and(eq(schema.productionRunFeedstocks.organizationId, TEST_ORG_ID), inArray(schema.productionRunFeedstocks.productionRunId, runIds)));
    await db.delete(schema.productionRunFeedstockDraws).where(and(eq(schema.productionRunFeedstockDraws.organizationId, TEST_ORG_ID), inArray(schema.productionRunFeedstockDraws.productionRunId, runIds)));
    await db.delete(schema.productionRuns).where(and(eq(schema.productionRuns.organizationId, TEST_ORG_ID), inArray(schema.productionRuns.id, runIds)));
  }
  if (facilityIds.length) {
    await db.delete(schema.feedstocks).where(and(eq(schema.feedstocks.organizationId, TEST_ORG_ID), inArray(schema.feedstocks.facilityId, facilityIds)));
    await db.delete(schema.storageLocations).where(and(eq(schema.storageLocations.organizationId, TEST_ORG_ID), inArray(schema.storageLocations.facilityId, facilityIds)));
    // Membership activity need not carry facilityId; its run link is stable.
    if (runIds.length) await db.delete(schema.activityEvents).where(and(eq(schema.activityEvents.organizationId, TEST_ORG_ID), inArray(schema.activityEvents.productionRunId, runIds)));
    const batches = await db.select({ id: schema.creditBatches.id }).from(schema.creditBatches)
      .where(and(eq(schema.creditBatches.organizationId, TEST_ORG_ID), inArray(schema.creditBatches.facilityId, facilityIds)));
    if (batches.length) await db.delete(schema.activityEvents).where(and(eq(schema.activityEvents.organizationId, TEST_ORG_ID), inArray(schema.activityEvents.creditBatchId, batches.map(row => row.id))));
  }
  await cleanupFeedstockFixtureParents(db);
  await calendar.cleanup();
}, TEST_TIMEOUT_MS);
afterAll(() => pool.end());

// Calendar parents plus the real stock/output inputs used by the facility-zone
// membership suite. Completion below runs the production mutation and allocator.
async function fixture(label: string, unassigned = false) {
  const facility = await calendar.facility(label, OLD_ZONE);
  facilityIds.push(facility.id);
  const october = await calendar.batch(facility.id, null, `${label}-OCT`);
  if (unassigned) await db.update(schema.creditBatches).set(AUGUST).where(and(eq(schema.creditBatches.id, october.id), eq(schema.creditBatches.organizationId, TEST_ORG_ID)));
  const september = unassigned ? undefined : await calendar.batch(facility.id, null, `${label}-SEP`);
  if (september) await db.update(schema.creditBatches).set({
    ...SEPTEMBER, feedstockTypeId: october.feedstockTypeId, productionProcessId: october.productionProcessId,
  }).where(and(eq(schema.creditBatches.id, september.id), eq(schema.creditBatches.organizationId, TEST_ORG_ID)));
  const outputBinId = await createProductionRunOutputBin(TEST_ORG_ID, facility.id);
  const [bin] = await db.insert(schema.storageLocations).values({
    organizationId: TEST_ORG_ID, facilityId: facility.id, feedstockTypeId: october.feedstockTypeId,
    code: `BIN-${facility.code}`, name: `Race bin ${facility.code}`, type: "feedstock_bin",
  }).returning();
  await db.insert(schema.feedstocks).values(await feedstockFixtureValues(db, {
    organizationId: TEST_ORG_ID, facilityId: facility.id, feedstockTypeId: october.feedstockTypeId,
    storageLocationId: bin.id, code: `FS-${facility.code}`, status: "complete",
    massWetKg: FEEDSTOCK_WET_KG, massDryKg: FEEDSTOCK_DRY_KG, moistureContentPercent: MOISTURE_PERCENT,
  }));
  const run = await calendar.run(facility.id, label, RUN_START);
  runIds.push(run.id);
  await db.update(schema.productionRuns).set({ status: "running", endTime: null })
    .where(and(eq(schema.productionRuns.id, run.id), eq(schema.productionRuns.organizationId, TEST_ORG_ID)));
  const completion = {
    expectedVersion: run.version, status: "complete" as const, endTime: new Date(RUN_END),
    feedstockMoisturePercent: MOISTURE_PERCENT,
    feedstockDraws: [{ storageLocationId: bin.id, wetMassKg: DRAW_WET_KG }],
    biocharStorageLocationId: outputBinId, biocharOutputKg: BIOCHAR_WET_KG, biocharMoisturePercent: MOISTURE_PERCENT,
  };
  return { facility, october, september, run, completion };
}
async function assignments(runId: string, tx: Pick<DbTransaction, "select"> = db) {
  return tx.select({ creditBatchId: schema.creditBatchProductionRuns.creditBatchId }).from(schema.creditBatchProductionRuns)
    .where(and(eq(schema.creditBatchProductionRuns.productionRunId, runId), eq(schema.creditBatchProductionRuns.organizationId, TEST_ORG_ID)));
}
function editZone(facility: { id: string; version: number }) {
  return updateFacility(ctx, facility.id, { expectedVersion: facility.version, timezone: NEW_ZONE });
}

describe("facility time zone and membership serialization", () => {
  it("zone edit first: completion waits, then attaches using the committed new zone", async () => {
    const f = await fixture("ZONE-FIRST");
    const zone = await barrier();
    let completion: Promise<Outcome> | undefined;
    try {
      const [locked] = await lockFacility(zone.tx, f.facility.id, "update");
      const timezone = await resolveFacilityTimezoneEdit(ctx, zone.tx, locked, NEW_ZONE);
      await zone.tx.update(schema.facilities).set({ timezone }).where(and(eq(schema.facilities.id, f.facility.id), eq(schema.facilities.organizationId, TEST_ORG_ID)));
      completion = outcome(updateProductionRun(ctx, f.run.id, f.completion));
      await waitForFacilityLock(zone.pid, "share");
      await zone.commit();
      expect(await completion).toMatchObject({ ok: true });
      expect(await assignments(f.run.id)).toEqual([{ creditBatchId: f.october.id }]);
    } finally { await zone.rollback(); await completion; }
  }, TEST_TIMEOUT_MS);

  it("attachment first: the real facility edit waits and then refuses the new membership", async () => {
    const f = await fixture("ATTACH-FIRST");
    const attachment = await barrier();
    let zone: Promise<Outcome> | undefined;
    try {
      await updateProductionRunInTransaction(ctx, attachment.tx, f.run.id, f.completion);
      expect(await assignments(f.run.id, attachment.tx)).toEqual([{ creditBatchId: f.september!.id }]);
      zone = outcome(editZone(f.facility));
      await waitForFacilityLock(attachment.pid, "update");
      await attachment.commit();
      assertConflict(await zone);
    } finally { await attachment.rollback(); await zone; }
  }, TEST_TIMEOUT_MS);

  it("KEY SHARE can upgrade to SHARE while another connection waits for UPDATE", async () => {
    const facility = await calendar.facility("KEY-SHARE", OLD_ZONE);
    const holder = await barrier();
    let waiter: Promise<Outcome> | undefined;
    try {
      await lockFacility(holder.tx, facility.id, "key share");
      waiter = outcome(db.transaction(tx => lockFacility(tx, facility.id, "update")));
      await waitForFacilityLock(holder.pid, "update");
      await lockFacility(holder.tx, facility.id, "share");
      await holder.commit();
      expect(await waiter).toMatchObject({ ok: true });
    } finally { await holder.rollback(); await waiter; }
  }, TEST_TIMEOUT_MS);

  it.each(["archive", "completion"] as const)("archive versus attaching run update, %s first: no deadlock", async first => {
    const f = await fixture(`ARCHIVE-${first}`);
    const pause = pauseNextCommit();
    const archive = () => outcome(archiveFacility(ctx, f.facility.id, f.facility.version));
    const complete = () => outcome(updateProductionRun(ctx, f.run.id, f.completion));
    const leading = first === "archive" ? archive() : complete();
    let trailing: Promise<Outcome> | undefined;
    try {
      await pause.ready(leading);
      trailing = first === "archive" ? complete() : archive();
      await waitForFacilityLock(pause.state.pid, first === "archive" ? "share" : "update");
      pause.resume();
      const results = await Promise.all([leading, trailing]);
      results.forEach(assertNoDeadlock);
      expect(results[0]).toMatchObject({ ok: true });
      if (first === "completion") {
        expect(results[1]).toMatchObject({ ok: true });
        expect(await assignments(f.run.id)).toEqual([{ creditBatchId: f.september!.id }]);
      }
    } finally { pause.resume(); await Promise.all([leading, trailing]); }
  }, TEST_TIMEOUT_MS);

  it("zone edit first: batch refresh discovers candidates only after the new calendar commits", async () => {
    const f = await fixture("BATCH-ZONE-FIRST", true);
    await updateProductionRun(ctx, f.run.id, f.completion);
    expect(await assignments(f.run.id)).toEqual([]);
    const zone = await barrier();
    let batch: Promise<Outcome> | undefined;
    try {
      const [locked] = await lockFacility(zone.tx, f.facility.id, "update");
      const timezone = await resolveFacilityTimezoneEdit(ctx, zone.tx, locked, NEW_ZONE);
      await zone.tx.update(schema.facilities).set({ timezone }).where(and(eq(schema.facilities.id, f.facility.id), eq(schema.facilities.organizationId, TEST_ORG_ID)));
      batch = outcome(updateCreditBatch(ctx, f.october.id, {
        expectedVersion: f.october.version,
        startDate: new Date(SEPTEMBER.startDate), endDate: new Date(SEPTEMBER.endDate),
      }));
      await waitForFacilityLock(zone.pid, "share");
      await zone.commit();
      // Under the new zone the unassigned run ends in October. A September
      // refresh must succeed empty, not retain a candidate read in the old zone.
      expect(await batch).toMatchObject({ ok: true, value: { productionRunIds: [] } });
      expect(await assignments(f.run.id)).toEqual([]);
    } finally { await zone.rollback(); await batch; }
  }, TEST_TIMEOUT_MS);

  it("batch update first: pulling in an unassigned run makes the waiting zone edit refuse", async () => {
    const f = await fixture("BATCH-FIRST", true);
    await updateProductionRun(ctx, f.run.id, f.completion);
    expect(await assignments(f.run.id)).toEqual([]);
    const pause = pauseNextCommit();
    const batch = outcome(updateCreditBatch(ctx, f.october.id, {
      expectedVersion: f.october.version,
      startDate: new Date(SEPTEMBER.startDate), endDate: new Date(SEPTEMBER.endDate),
    }));
    let zone: Promise<Outcome> | undefined;
    try {
      await pause.ready(batch);
      zone = outcome(editZone(f.facility));
      await waitForFacilityLock(pause.state.pid, "update");
      pause.resume();
      expect(await batch).toMatchObject({ ok: true });
      assertConflict(await zone);
      expect(await assignments(f.run.id)).toEqual([{ creditBatchId: f.october.id }]);
    } finally { pause.resume(); await Promise.all([batch, zone]); }
  }, TEST_TIMEOUT_MS);
});

// Sample moves use another facility so the target zone is still editable until
// the move commits. Both old and target calendars must be held before batches.
async function sampleWriter(kind: "create" | "move", targetBatchId: string, label: string) {
  const request = {
    sampleCode: `S-${label}-${crypto.randomUUID()}`, creditBatchId: targetBatchId,
    samplingTime: SAMPLE_DAY, totalCarbonPercent: SAMPLE_CARBON_PERCENT, organicCarbonPercent: SAMPLE_CARBON_PERCENT,
  };
  if (kind === "create") return async (tx: DbTransaction, samplingTime: Date) => {
    const result = await createSampleInTransaction(ctx, tx, { ...request, samplingTime });
    sampleIds.push(result.sample.id);
    return result;
  };
  const source = await calendar.facility(`${label}-SOURCE`, OLD_ZONE);
  const batch = await calendar.batch(source.id, null, `${label}-SOURCE`);
  const created = await db.transaction(tx => createSampleInTransaction(ctx, tx, { ...request, creditBatchId: batch.id }));
  sampleIds.push(created.sample.id);
  return (tx: DbTransaction, samplingTime: Date) => updateSampleInTransaction(ctx, tx, created.sample.id, {
    expectedVersion: created.sample.version, creditBatchId: targetBatchId, samplingTime,
  });
}

describe("Sample calendar serialization", () => {
  it.each(["create", "move"] as const)("zone edit first: Sample %s checks the window in the new zone", async kind => {
    const facility = await calendar.facility(`SAMPLE-ZONE-${kind}`, OLD_ZONE);
    const batch = await calendar.batch(facility.id, null, `SAMPLE-ZONE-${kind}`);
    const write = await sampleWriter(kind, batch.id, `ZONE-${kind}`);
    const zone = await barrier();
    let sample: Promise<Outcome> | undefined;
    try {
      const [locked] = await lockFacility(zone.tx, facility.id, "update");
      const timezone = await resolveFacilityTimezoneEdit(ctx, zone.tx, locked, NEW_ZONE);
      await zone.tx.update(schema.facilities).set({ timezone }).where(and(eq(schema.facilities.id, facility.id), eq(schema.facilities.organizationId, TEST_ORG_ID)));
      sample = outcome(db.transaction(tx => write(tx, new Date(RUN_END))));
      await waitForFacilityLock(zone.pid, "share");
      await zone.commit();
      expect(await sample).toMatchObject({ ok: true, value: { sample: { creditBatchId: batch.id, samplingTime: new Date(RUN_END) } } });
    } finally { await zone.rollback(); await sample; }
  }, TEST_TIMEOUT_MS);

  it.each(["create", "move"] as const)("Sample %s first: the waiting zone edit refuses after commit", async kind => {
    const facility = await calendar.facility(`SAMPLE-FIRST-${kind}`, OLD_ZONE);
    const batch = await calendar.batch(facility.id, null, `SAMPLE-FIRST-${kind}`);
    const write = await sampleWriter(kind, batch.id, `FIRST-${kind}`);
    const sample = await barrier();
    let zone: Promise<Outcome> | undefined;
    try {
      await write(sample.tx, SAMPLE_DAY);
      zone = outcome(editZone(facility));
      await waitForFacilityLock(sample.pid, "update");
      await sample.commit();
      assertConflict(await zone);
    } finally { await sample.rollback(); await zone; }
  }, TEST_TIMEOUT_MS);
});
