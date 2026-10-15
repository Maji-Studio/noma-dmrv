import { Pool } from "pg";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { db, type DbTransaction } from "@/db";
import { pgErrorCode, PG_DEADLOCK_DETECTED } from "@/db/errors";
import * as schema from "@/db/schema";
import { createCreditBatch, deleteCreditBatch, updateCreditBatch } from "@/data-access/credit-batches";
import { getPgPoolConfig } from "@/lib/pg-pool-config";
import { runOperationInProcess, type Operation } from "@/lib/operations/runner";
import { recordApplication, updateApplication, deleteApplication } from "@/lib/operations/applications";
import { updateProductionRun } from "@/lib/operations/production-runs";
import { lockCreditBatchDeclarationRuns } from "@/data-access/credit-batch-membership";
import { CONCURRENCY_BARRIER_TIMEOUT_MS, createLineageFixture, cleanupLineageFixture, type LineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext } from "./helpers/test-org";
import { openOperationBarrier, waitForBlockedOperations } from "./helpers/operation-barrier";
import type { z } from "zod";

const pauses = vi.hoisted(() => ({
  membership: undefined as undefined | ((tx: DbTransaction) => Promise<void>),
  application: undefined as undefined | ((tx: DbTransaction) => Promise<void>),
  declaration: undefined as undefined | ((tx: DbTransaction) => Promise<void>),
  prepare: undefined as undefined | ((tx: DbTransaction) => Promise<void>),
  beforePrepare: undefined as undefined | (() => Promise<void>),
  scope: undefined as undefined | ((tx: DbTransaction) => Promise<void>),
  membershipError: undefined as undefined | ((error: unknown) => void),
}));
vi.mock("@/data-access/credit-batch-membership", async importOriginal => {
  const original = await importOriginal<typeof import("@/data-access/credit-batch-membership")>();
  return { ...original, lockCreditBatchDeclarationRuns: async (...args: Parameters<typeof original.lockCreditBatchDeclarationRuns>) => {
    const result = await original.lockCreditBatchDeclarationRuns(...args);
    const pause = pauses.declaration; pauses.declaration = undefined;
    if (pause) await pause(args[1]);
    return result;
  }, lockCreditBatchForUpdate: async (...args: Parameters<typeof original.lockCreditBatchForUpdate>) => {
    const result = await original.lockCreditBatchForUpdate(...args).catch(error => {
      pauses.membershipError?.(error);
      throw error;
    });
    const pause = pauses.membership; pauses.membership = undefined;
    if (pause) await pause(args[1]);
    return result;
  }, prepareCreditBatchMembershipWrite: async (...args: Parameters<typeof original.prepareCreditBatchMembershipWrite>) => {
    await pauses.beforePrepare?.();
    const result = await original.prepareCreditBatchMembershipWrite(...args);
    const pause = pauses.prepare; pauses.prepare = undefined;
    if (pause) await pause(args[1]);
    return result;
  } };
});
vi.mock("@/data-access/production-processes", async importOriginal => {
  const original = await importOriginal<typeof import("@/data-access/production-processes")>();
  return { ...original, lockProductionProcessScope: async (...args: Parameters<typeof original.lockProductionProcessScope>) => {
    await original.lockProductionProcessScope(...args);
    const pause = pauses.scope; pauses.scope = undefined;
    if (pause) await pause(args[0] as DbTransaction);
  } };
});
vi.mock("@/data-access/certification-lineage-guards", async importOriginal => {
  const original = await importOriginal<typeof import("@/data-access/certification-lineage-guards")>();
  return { ...original, lockCertifiedLineageArtifacts: async (...args: Parameters<typeof original.lockCertifiedLineageArtifacts>) => {
    const result = await original.lockCertifiedLineageArtifacts(...args);
    const pause = pauses.application; pauses.application = undefined;
    if (pause) await pause(args[1]);
    return result;
  } };
});
const pool = new Pool({ ...getPgPoolConfig(process.env.DATABASE_URL!), max: 5 });
const options = { pool };
const ctx = makeTestOrgContext("membership-lock-tests");
const APPLICATION_DAY = "2026-06-16";
const MEMBERSHIP_DEADLOCK_TIMEOUT_MS = 100;
const MEMBERSHIP_DEADLOCK_TEST_TIMEOUT_MS = 3 * CONCURRENCY_BARRIER_TIMEOUT_MS + MEMBERSHIP_DEADLOCK_TIMEOUT_MS;
beforeAll(async () => {
  await ensureTestOrg();
  await db.insert(schema.users).values({ id: ctx.userId, email: "membership-lock-tests@example.test" }).onConflictDoNothing();
});
afterAll(() => pool.end());
function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
function outcome(promise: Promise<unknown>) {
  return promise.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}
async function waitForPause(ready: ReturnType<typeof gate>, write: ReturnType<typeof outcome>, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      ready.promise,
      write.then(result => {
        if (!result.ok) throw result.error;
        throw new Error(`${label} finished without reaching its pause`);
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} did not reach its pause`)), CONCURRENCY_BARRIER_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function hold(ready: ReturnType<typeof gate>, resume: ReturnType<typeof gate>, state: { pid: number }) {
  return async (tx: DbTransaction) => {
    state.pid = (await tx.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`)).rows[0].pid;
    ready.release();
    await resume.promise;
  };
}
function holdAfterWrite<I extends z.ZodType, O>(operation: Operation<I, O>, pause: (tx: DbTransaction) => Promise<void>): Operation<I, O> {
  return { ...operation, execute: async (scope, input) => {
    const result = await operation.execute(scope, input);
    await pause(scope.tx);
    return result;
  } };
}
async function fixture(emptyMembership = false) {
  const f = await createLineageFixture("none");
  await db.update(schema.productionRuns).set({ status: "complete", endTime: new Date("2026-06-13T12:00:00Z") }).where(eq(schema.productionRuns.id, f.productionRunId));
  await db.delete(schema.samples).where(eq(schema.samples.id, f.sampleId));
  await db.update(schema.creditBatchApplications).set({ removalId: null }).where(eq(schema.creditBatchApplications.applicationId, f.applicationId));
  if (emptyMembership) {
    await db.delete(schema.creditBatchApplications).where(eq(schema.creditBatchApplications.creditBatchId, f.batchId));
    await db.delete(schema.creditBatchProductionRuns).where(eq(schema.creditBatchProductionRuns.creditBatchId, f.batchId));
  }
  return f;
}
async function assertMass(f: LineageFixture, wetKg: number, hasBatch = true) {
  const [app] = await db.select().from(schema.applications).where(eq(schema.applications.id, f.applicationId));
  expect(app.biocharAppliedTons).toBe(wetKg / 1000);
  expect(app.biocharAppliedDryTons).toBe(wetKg * 0.95 / 1000);
  const shares = await db.select().from(schema.applicationOutputAllocations).where(eq(schema.applicationOutputAllocations.applicationId, f.applicationId));
  expect(shares.map(row => [row.productionRunId, Number(row.wetMassKg), Number(row.dryMassKg)])).toEqual([[f.productionRunId, wetKg, wetKg * 0.95]]);
  const slices = await db.select().from(schema.creditBatchApplications).where(eq(schema.creditBatchApplications.applicationId, f.applicationId));
  expect(slices.map(row => [row.creditBatchId, Number(row.allocatedWetMassKg), Number(row.allocatedDryMassKg), row.removalId])).toEqual(hasBatch ? [[f.batchId, wetKg, wetKg * 0.95, null]] : []);
}

it.each(["application", "membership"] as const)("shared artifact serializes membership and application writers, %s first", async firstKind => {
  const f = await createLineageFixture("none");
  // Keep the Removal-owned slice so both writers really share an artifact.
  // The membership request must reach its existing Removal refusal, without
  // exposing a PostgreSQL deadlock from its transaction.
  const ready = gate(); const resume = gate(); const state = { pid: 0 };
  const applicationWrite = () => outcome(runOperationInProcess(updateApplication, ctx, { applicationId: f.applicationId, expectedVersion: 1, cropType: "Maize" }, options));
  const membershipWrite = () => outcome(updateCreditBatch(ctx, f.batchId, { expectedVersion: 1, productionRunIds: [f.productionRunId] }));
  const pause = hold(ready, resume, state);
  if (firstKind === "application") pauses.application = pause;
  else pauses.membership = pause;
  const first = firstKind === "application" ? applicationWrite() : membershipWrite();
  await ready.promise;
  const second = firstKind === "application" ? membershipWrite() : applicationWrite();
  const application = firstKind === "application" ? first : second;
  const membership = firstKind === "membership" ? first : second;
  try {
    try { await waitForBlockedOperations(pool, state.pid, 1); } finally { resume.release(); }
    expect(await application).toMatchObject({ ok: true, value: { application: { cropType: "Maize", version: 2 } } });
    const result = await membership;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(String(result.error)).toContain("Cannot change this credit batch's production membership because its applied mass belongs to a Removal.");
    const [slice] = await db.select().from(schema.creditBatchApplications).where(eq(schema.creditBatchApplications.applicationId, f.applicationId));
    expect(slice).toMatchObject({ removalId: f.removalId, allocatedWetMassKg: 200, allocatedDryMassKg: 190 });
    const [batch] = await db.select().from(schema.creditBatches).where(eq(schema.creditBatches.id, f.batchId));
    expect(batch.version).toBe(1);
  } finally {
    resume.release(); pauses.application = undefined; pauses.membership = undefined;
    await Promise.all([application, membership]);
    await cleanupLineageFixture(f);
  }
}, CONCURRENCY_BARRIER_TIMEOUT_MS);

it.each(["membership", "application"] as const)("membership update reconciles a concurrent application mass change, %s first", async firstKind => {
  const f = await fixture(true);
  const ready = gate(); const resume = gate(); const state = { pid: 0 };
  const pause = hold(ready, resume, state);
  const command = { applicationId: f.applicationId, expectedVersion: 1, appliedWetMassKg: 150 };
  const membership = () => updateCreditBatch(ctx, f.batchId, { expectedVersion: 1, productionRunIds: [f.productionRunId] });
  if (firstKind === "membership") pauses.membership = pause;
  const first = outcome(firstKind === "membership" ? membership() : runOperationInProcess(holdAfterWrite(updateApplication, pause), ctx, command, options));
  await ready.promise;
  const second = outcome(firstKind === "membership" ? runOperationInProcess(updateApplication, ctx, command, options) : membership());
  try {
    try { await waitForBlockedOperations(pool, state.pid, 1); } finally { resume.release(); }
    expect((await first).ok).toBe(true);
    const result = await second;
    if (firstKind === "membership") {
      expect(result).toMatchObject({ ok: false, error: { code: "conflict", retryable: true } });
      await assertMass(f, 200);
      await runOperationInProcess(updateApplication, ctx, command, options);
    } else expect(result.ok).toBe(true);
    await assertMass(f, 150);
    const links = await db.select().from(schema.creditBatchProductionRuns).where(eq(schema.creditBatchProductionRuns.creditBatchId, f.batchId));
    expect(links.map(row => row.productionRunId)).toEqual([f.productionRunId]);
  } finally {
    resume.release(); pauses.membership = undefined;
    await Promise.all([first, second]);
    await cleanupLineageFixture(f);
  }
}, CONCURRENCY_BARRIER_TIMEOUT_MS);

it.each(["membership", "application"] as const)("membership update versus application delete, %s first", async firstKind => {
  const f = await fixture(true);
  const ready = gate(); const resume = gate(); const state = { pid: 0 };
  const pause = hold(ready, resume, state);
  const command = { applicationId: f.applicationId, expectedVersion: 1 };
  const membership = () => updateCreditBatch(ctx, f.batchId, { expectedVersion: 1, productionRunIds: [f.productionRunId] });
  if (firstKind === "membership") pauses.membership = pause;
  const first = outcome(firstKind === "membership" ? membership() : runOperationInProcess(holdAfterWrite(deleteApplication, pause), ctx, command, options));
  await ready.promise;
  const second = outcome(firstKind === "membership" ? runOperationInProcess(deleteApplication, ctx, command, options) : membership());
  try {
    try { await waitForBlockedOperations(pool, state.pid, 1); } finally { resume.release(); }
    expect((await first).ok).toBe(true);
    const result = await second;
    if (firstKind === "membership") {
      expect(result).toMatchObject({ ok: false, error: { code: "conflict", retryable: true } });
      await runOperationInProcess(deleteApplication, ctx, command, options);
    } else expect(result.ok).toBe(true);
    expect(await db.select().from(schema.applications).where(eq(schema.applications.id, f.applicationId))).toEqual([]);
    expect(await db.select().from(schema.applicationOutputAllocations).where(eq(schema.applicationOutputAllocations.applicationId, f.applicationId))).toEqual([]);
    expect(await db.select().from(schema.creditBatchApplications).where(eq(schema.creditBatchApplications.applicationId, f.applicationId))).toEqual([]);
    const links = await db.select().from(schema.creditBatchProductionRuns).where(eq(schema.creditBatchProductionRuns.creditBatchId, f.batchId));
    expect(links.map(row => row.productionRunId)).toEqual([f.productionRunId]);
  } finally {
    resume.release(); pauses.membership = undefined;
    await Promise.all([first, second]);
    await cleanupLineageFixture(f);
  }
}, CONCURRENCY_BARRIER_TIMEOUT_MS);

it.each(["membership", "application"] as const)("batch delete versus application mass change, %s first", async firstKind => {
  const f = await fixture();
  const ready = gate(); const resume = gate(); const state = { pid: 0 };
  const pause = hold(ready, resume, state);
  const command = { applicationId: f.applicationId, expectedVersion: 1, appliedWetMassKg: 150 };
  const membership = () => deleteCreditBatch(ctx, f.batchId, 1);
  if (firstKind === "membership") pauses.membership = pause;
  const first = outcome(firstKind === "membership" ? membership() : runOperationInProcess(holdAfterWrite(updateApplication, pause), ctx, command, options));
  await ready.promise;
  const second = outcome(firstKind === "membership" ? runOperationInProcess(updateApplication, ctx, command, options) : membership());
  try {
    try { await waitForBlockedOperations(pool, state.pid, 1); } finally { resume.release(); }
    expect((await first).ok).toBe(true);
    const result = await second;
    if (firstKind === "membership") {
      expect(result).toMatchObject({ ok: false, error: { code: "conflict", retryable: true } });
      await runOperationInProcess(updateApplication, ctx, command, options);
    } else expect(result.ok).toBe(true);
    await assertMass(f, 150, false);
    expect(await db.select().from(schema.creditBatches).where(eq(schema.creditBatches.id, f.batchId))).toEqual([]);
    expect(await db.select().from(schema.creditBatchProductionRuns).where(eq(schema.creditBatchProductionRuns.creditBatchId, f.batchId))).toEqual([]);
  } finally {
    resume.release(); pauses.membership = undefined;
    await Promise.all([first, second]);
    await cleanupLineageFixture(f);
  }
}, CONCURRENCY_BARRIER_TIMEOUT_MS);

it.each(["membership", "application"] as const)("batch create covers the delivery run versus application create, %s first", async firstKind => {
  const f = await fixture();
  await deleteCreditBatch(ctx, f.batchId, 1);
  await db.delete(schema.applicationOutputAllocations).where(eq(schema.applicationOutputAllocations.applicationId, f.applicationId));
  await db.delete(schema.applications).where(eq(schema.applications.id, f.applicationId));
  const ready = gate(); const resume = gate(); const state = { pid: 0 };
  const pause = hold(ready, resume, state);
  const command = { deliveryId: f.deliveryId, appliedWetMassKg: 150, applicationDate: APPLICATION_DAY, fieldSizeHa: 1, gpsLatitude: 0, gpsLongitude: 0 };
  const membership = () => createCreditBatch(ctx, {
    code: `E2E-MEMBERSHIP-${f.batchId}`, facilityId: f.facilityId, feedstockTypeId: f.feedstockTypeId,
    startDate: new Date("2026-06-01"), endDate: new Date("2026-06-30"), productionRunIds: [f.productionRunId],
  }).then(batch => { f.batchId = batch.id; return batch; });
  const application = (operation = recordApplication) => runOperationInProcess(operation, ctx, command, options)
    .then(result => { f.applicationId = result.application.id; return result.application; });
  if (firstKind === "membership") pauses.declaration = pause;
  const first = outcome(firstKind === "membership" ? membership() : application(holdAfterWrite(recordApplication, pause)));
  await ready.promise;
  const second = outcome(firstKind === "membership" ? application() : membership());
  try {
    try { await waitForBlockedOperations(pool, state.pid, 1); } finally { resume.release(); }
    expect((await first).ok).toBe(true);
    const result = await second;
    if (firstKind === "membership") {
      expect(result).toMatchObject({ ok: false, error: { code: "conflict", retryable: true } });
      await application();
    } else expect(result.ok).toBe(true);
    await assertMass(f, 150);
    const links = await db.select().from(schema.creditBatchProductionRuns).where(eq(schema.creditBatchProductionRuns.creditBatchId, f.batchId));
    expect(links.map(row => row.productionRunId)).toEqual([f.productionRunId]);
    const apps = await db.select().from(schema.applications).where(eq(schema.applications.deliveryId, f.deliveryId));
    expect(apps.map(app => app.id)).toEqual([f.applicationId]);
  } finally {
    resume.release(); pauses.declaration = undefined;
    await Promise.all([first, second]);
    await cleanupLineageFixture(f);
  }
}, CONCURRENCY_BARRIER_TIMEOUT_MS);

it.each(["membership", "completion"] as const)("notes edit retries a scope/artifact deadlock with run completion, %s first", async firstKind => {
  const f = await createLineageFixture("none");
  // The existing run's output already has a delivery allocation, so its
  // output-basis guard refuses completion before attachment can take scope.
  // Keep that completed member's Removal artifact and complete an unused run.
  await db.update(schema.productionRuns).set({ status: "complete", endTime: new Date("2026-06-13T12:00:00Z") })
    .where(eq(schema.productionRuns.id, f.productionRunId));
  await db.update(schema.feedstocks).set({ massWetKg: 2_000, massDryKg: 1_800 }).where(eq(schema.feedstocks.id, f.feedstockId));
  const [completingRun] = await db.insert(schema.productionRuns).values({
    organizationId: ctx.organizationId, facilityId: f.facilityId, reactorId: f.reactorId,
    code: `E2E-COMPLETION-${f.batchId}`, status: "running", startTime: new Date("2026-06-14T08:00:00Z"),
    feedstockWetMassKg: 1_000, feedstockMoisturePercent: 10, feedstockMassDryKg: 900,
    biocharStorageLocationId: f.biocharBinId, biocharOutputKg: 300, biocharMoisturePercent: 5, biocharDryMassKg: 285,
  }).returning();
  await db.insert(schema.productionRunFeedstockDraws).values({
    organizationId: ctx.organizationId, productionRunId: completingRun.id, storageLocationId: f.feedstockBinId, wetMassKg: 1_000,
  });
  await db.insert(schema.productionRunFeedstocks).values({
    organizationId: ctx.organizationId, productionRunId: completingRun.id, feedstockId: f.feedstockId, wetMassUsedKg: 1_000,
  });
  const membershipReady = gate(); const membershipResume = gate();
  const completionReady = gate(); const completionResume = gate(); const completionDone = gate();
  const membershipState = { pid: 0 }; const completionState = { pid: 0 };
  let attempts = 0;
  let completionAttempts = 0;
  const membershipErrors: unknown[] = [];
  pauses.membershipError = error => { membershipErrors.push(error); };
  pauses.beforePrepare = async () => {
    // Let the retried transaction discover the committed membership. The
    // version below is the serial version after auto-attachment, so this
    // pins transaction retry independently of stale-form refusal.
    if (++attempts > 1) await completionDone.promise;
  };
  pauses.prepare = async tx => {
    await tx.execute(sql`select
      set_config('deadlock_timeout', ${String(MEMBERSHIP_DEADLOCK_TIMEOUT_MS)}, true),
      set_config('lock_timeout', ${String(CONCURRENCY_BARRIER_TIMEOUT_MS)}, true)`);
    await hold(membershipReady, membershipResume, membershipState)(tx);
  };
  const pauseCompletion = async (tx: DbTransaction) => {
    // Choose membership as the deadlock victim rather than depending on
    // PostgreSQL's arbitrary victim selection. Both transactions really wait.
    await tx.execute(sql`select
      set_config('deadlock_timeout', ${String(CONCURRENCY_BARRIER_TIMEOUT_MS)}, true),
      set_config('lock_timeout', ${String(CONCURRENCY_BARRIER_TIMEOUT_MS)}, true)`);
    await hold(completionReady, completionResume, completionState)(tx);
  };
  const membership = () => outcome(updateCreditBatch(ctx, f.batchId, {
    expectedVersion: 2, siteManagementNotes: "Checked site management",
  }));
  const completion = () => {
    // Membership preparation has no scope lock, so this pause belongs to
    // attachment in either starting order.
    pauses.scope = pauseCompletion;
    return outcome(runOperationInProcess({ ...updateProductionRun, execute: (scope, input) => {
      completionAttempts++;
      return updateProductionRun.execute(scope, input);
    } }, ctx, {
      productionRunId: completingRun.id, expectedVersion: 1, status: "complete",
      endTime: new Date("2026-06-14T12:00:00Z"),
      biocharStorageLocationId: f.biocharBinId, biocharOutputKg: 300, biocharMoisturePercent: 5,
    }, { ...options, deadlineMs: MEMBERSHIP_DEADLOCK_TEST_TIMEOUT_MS })).finally(completionDone.release);
  };
  const first = firstKind === "membership" ? membership() : completion();
  let second: ReturnType<typeof outcome> | undefined;
  try {
    await waitForPause(firstKind === "membership" ? membershipReady : completionReady, first, firstKind);
    second = firstKind === "membership" ? completion() : membership();
    await waitForPause(firstKind === "membership" ? completionReady : membershipReady, second, firstKind === "membership" ? "completion" : "membership");
    // Queue attachment on membership's artifact before membership requests
    // attachment's scope. Membership's first deadlock check then sees a cycle;
    // it cannot fire too early and leave victim selection to completion.
    completionResume.release();
    expect(await waitForBlockedOperations(pool, membershipState.pid, 1)).toEqual([completionState.pid]);
    const { rows: waitingLocks } = await pool.query<{ locktype: string }>(
      "select locktype from pg_locks where pid = $1 and not granted", [completionState.pid],
    );
    expect(waitingLocks).toEqual([{ locktype: "advisory" }]);
    membershipResume.release();
    expect(await first).toMatchObject({ ok: true });
    expect(await second).toMatchObject({ ok: true });
    expect(attempts).toBe(2);
    expect(membershipErrors.map(pgErrorCode)).toEqual([PG_DEADLOCK_DETECTED]);
    expect(completionAttempts).toBe(1);
    const [batch] = await db.select().from(schema.creditBatches).where(eq(schema.creditBatches.id, f.batchId));
    expect(batch).toMatchObject({ siteManagementNotes: "Checked site management", version: 3 });
    const [run] = await db.select().from(schema.productionRuns).where(eq(schema.productionRuns.id, completingRun.id));
    expect(run).toMatchObject({ status: "complete", version: 2 });
    const links = await db.select().from(schema.creditBatchProductionRuns).where(eq(schema.creditBatchProductionRuns.creditBatchId, f.batchId));
    expect(links.map(row => row.productionRunId).sort()).toEqual([f.productionRunId, completingRun.id].sort());
    const [slice] = await db.select().from(schema.creditBatchApplications).where(eq(schema.creditBatchApplications.applicationId, f.applicationId));
    expect(slice.removalId).toBe(f.removalId);
  } finally {
    membershipResume.release(); completionResume.release(); completionDone.release();
    pauses.prepare = undefined; pauses.beforePrepare = undefined; pauses.scope = undefined;
    pauses.membershipError = undefined;
    await Promise.all([first, second]);
    await db.delete(schema.creditBatchProductionRuns).where(eq(schema.creditBatchProductionRuns.productionRunId, completingRun.id));
    await db.delete(schema.productionRunFeedstocks).where(eq(schema.productionRunFeedstocks.productionRunId, completingRun.id));
    await db.delete(schema.productionRunFeedstockDraws).where(eq(schema.productionRunFeedstockDraws.productionRunId, completingRun.id));
    await db.delete(schema.outputStockMoistureReadings).where(eq(schema.outputStockMoistureReadings.productionRunId, completingRun.id));
    await db.delete(schema.productionRuns).where(eq(schema.productionRuns.id, completingRun.id));
    await cleanupLineageFixture(f);
  }
}, MEMBERSHIP_DEADLOCK_TEST_TIMEOUT_MS);

it("answers conflict without waiting when a newly matching unassigned run is busy", async () => {
  const f = await fixture(true);
  const barrier = await openOperationBarrier(pool);
  let declaration: ReturnType<typeof outcome> | undefined;
  try {
    await barrier.tx.select({ id: schema.productionRuns.id }).from(schema.productionRuns)
      .where(eq(schema.productionRuns.id, f.productionRunId)).for("update");
    declaration = outcome(db.transaction(tx => lockCreditBatchDeclarationRuns(ctx, tx, {
      facilityId: f.facilityId, feedstockTypeId: f.feedstockTypeId,
      startDate: "2026-06-01", endDate: "2026-06-30", requestedProductionRunIds: [],
      // Discovery happened before this run completed. Its row is still held
      // by another writer when declaration refreshes the matching set.
      matchingProductionRunIds: [],
    })));
    expect(await declaration).toMatchObject({ ok: false, error: { code: "conflict", retryable: true } });
  } finally {
    await barrier.rollback();
    await declaration;
    await cleanupLineageFixture(f);
  }
}, CONCURRENCY_BARRIER_TIMEOUT_MS);

it.each(["notes", "code", "delete"] as const)("%s does not wait for a locked member run", async mutation => {
  const f = await fixture();
  const barrier = await openOperationBarrier(pool);
  let write: ReturnType<typeof outcome> | undefined;
  try {
    await barrier.tx.select({ id: schema.productionRuns.id }).from(schema.productionRuns)
      .where(eq(schema.productionRuns.id, f.productionRunId)).for("update");
    write = outcome(mutation === "delete" ? deleteCreditBatch(ctx, f.batchId, 1) : updateCreditBatch(ctx, f.batchId, {
      expectedVersion: 1,
      ...(mutation === "notes" ? { siteManagementNotes: "Checked site management" } : { code: `E2E-EDIT-${f.batchId}` }),
    }));
    // The member stays locked until the scalar edit or delete has committed.
    expect(await write).toMatchObject({ ok: true });
  } finally {
    await barrier.rollback();
    await write;
    await cleanupLineageFixture(f);
  }
}, CONCURRENCY_BARRIER_TIMEOUT_MS);
