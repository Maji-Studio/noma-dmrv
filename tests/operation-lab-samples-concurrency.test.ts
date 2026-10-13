/**
 * Lab sample writers racing each other and the batch writers (Phase 5a
 * commit 2). A barrier transaction holds the credit batch row, every writer
 * queues on it in a known order, and the barrier commits: the first in the
 * queue wins, and the second sees its result under the batch lock. Writers
 * run on their own pool so two of them can wait at once.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.hoisted(() => {
  process.env.DB_POOL_LOCK_TIMEOUT_MS = "5000";
});
import { and, eq } from "drizzle-orm";
import type { Pool } from "pg";
import { db } from "@/db";
import { creditBatches, samples, transportLegs } from "@/db/schema";
import { deleteCreditBatch, updateCreditBatch } from "@/data-access/credit-batches";
import { archiveFacility } from "@/data-access/facilities";
import { createTransportLeg } from "@/data-access/transport-legs";
import { deleteLabSample, recordLabSample, updateLabSample } from "@/lib/operations/lab-samples";
import { runOperation, runOperationInProcess } from "@/lib/operations/runner";
import { SafeError } from "@/lib/errors";
import { cleanupLabSampleFixture, createLabSampleFixture, type LabSampleFixture, type LabSampleFixtureOptions } from "./helpers/lab-sample-fixture";
import { labLogisticsVersion } from "./helpers/lab-logistics-version";
import { masterDataVersion } from "./helpers/master-data-version";
import { openOperationBarrier, waitForBlockedOperations } from "./helpers/operation-barrier";
import { createTestPool } from "./helpers/operation-fixture";

const SUITE_TIMEOUT_MS = 60_000;
const BARRIER_POOL_SIZE = 2;
const WRITER_POOL_SIZE = 3;
const IN_WINDOW = "2026-09-10T08:00:00Z";
/** The writers' copy as SafeError normalizes it for the operator. */
const SAMPLE_NOT_FOUND = new SafeError("Sample not found").message;
const BATCH_NOT_FOUND = new SafeError("Credit batch not found").message;

let barrierPool: Pool;
let writerPool: Pool;
const fixtures: LabSampleFixture[] = [];

beforeAll(() => {
  barrierPool = createTestPool(BARRIER_POOL_SIZE);
  writerPool = createTestPool(WRITER_POOL_SIZE);
});
afterEach(async () => {
  for (const f of fixtures.splice(0)) await cleanupLabSampleFixture(f);
});
afterAll(async () => {
  await barrierPool.end();
  await writerPool.end();
});

async function fixture(options?: LabSampleFixtureOptions) {
  const f = await createLabSampleFixture(options);
  fixtures.push(f);
  return f;
}

const input = (f: LabSampleFixture) => ({ creditBatchId: f.batchA.id, samplingTime: IN_WINDOW, totalCarbonPercent: 80, organicCarbonPercent: 75 });
const settle = <T>(promise: Promise<T>) => promise.then((value) => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
const sampleRows = (f: LabSampleFixture) => db.select().from(samples).where(eq(samples.organizationId, f.ctx.organizationId));

/**
 * Holds batch A, starts `writers` one at a time so they queue on it in order,
 * then commits. Returns each writer's settled outcome, in start order.
 */
async function queueOnBatch(f: LabSampleFixture, writers: (() => Promise<unknown>)[]) {
  const barrier = await openOperationBarrier(barrierPool);
  const started: Promise<{ ok: boolean; value?: unknown; error?: unknown }>[] = [];
  try {
    await barrier.tx.select({ id: creditBatches.id }).from(creditBatches)
      .where(and(eq(creditBatches.id, f.batchA.id), eq(creditBatches.organizationId, f.ctx.organizationId))).for("update");
    for (const [index, write] of writers.entries()) {
      started.push(settle(write()));
      await waitForBlockedOperations(barrierPool, barrier.pid, index + 1);
    }
    await barrier.commit();
  } catch (error) {
    await barrier.rollback();
    await Promise.allSettled(started);
    throw error;
  }
  return Promise.all(started);
}

describe("lab sample writers race", { timeout: SUITE_TIMEOUT_MS }, () => {
  it.each([["the form first", true], ["the API first", false]] as const)("UI and API updates on one version: %s wins, the other is stale", async (_label, formFirst) => {
    const f = await fixture();
    const created = (await runOperation(recordLabSample, f.ctx, input(f))).data.sample;
    const form = () => runOperationInProcess(updateLabSample, f.ctx, { labSampleId: created.id, expectedVersion: 1, labName: "Form" }, { pool: writerPool });
    const api = () => runOperation(updateLabSample, f.ctx, { labSampleId: created.id, expectedVersion: 1, labName: "API" }, { pool: writerPool });
    const [first, second] = await queueOnBatch(f, formFirst ? [form, api] : [api, form]);
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, error: { code: "stale_version" } });
    expect(await sampleRows(f)).toMatchObject([{ version: 2, labName: formFirst ? "Form" : "API" }]);
  });

  it.each([["update first", true], ["delete first", false]] as const)("update against delete: %s", async (_label, updateFirst) => {
    const f = await fixture();
    const created = (await runOperation(recordLabSample, f.ctx, input(f))).data.sample;
    const update = () => runOperation(updateLabSample, f.ctx, { labSampleId: created.id, expectedVersion: 1, labName: "Edit" }, { pool: writerPool });
    const remove = () => runOperation(deleteLabSample, f.ctx, { labSampleId: created.id, expectedVersion: 1 }, { pool: writerPool });
    const [first, second] = await queueOnBatch(f, updateFirst ? [update, remove] : [remove, update]);
    expect(first.ok).toBe(true);
    if (updateFirst) {
      // The delete was sent with the version the update replaced.
      expect(second).toMatchObject({ ok: false, error: { code: "stale_version" } });
      expect(await sampleRows(f)).toMatchObject([{ version: 2, labName: "Edit" }]);
    } else {
      expect(second).toMatchObject({ ok: false, error: { code: "not_found", message: SAMPLE_NOT_FOUND } });
      expect(await sampleRows(f)).toEqual([]);
    }
  });

  it.each([["create first", true], ["archive first", false]] as const)("create against a facility archive: %s", async (_label, createFirst) => {
    const f = await fixture();
    const create = () => runOperation(recordLabSample, f.ctx, input(f), { pool: writerPool });
    const archive = async () => archiveFacility(f.ctx, f.facility.id, await masterDataVersion(f.ctx, "facilities", f.facility.id));
    const [first, second] = await queueOnBatch(f, createFirst ? [create, archive] : [archive, create]);
    expect(first.ok).toBe(true);
    if (createFirst) {
      // The archive then stamps the batch; the saved sample stays readable.
      expect(second.ok).toBe(true);
      expect(await sampleRows(f)).toHaveLength(1);
    } else {
      expect(second).toMatchObject({ ok: false, error: { code: "not_found", issues: [expect.objectContaining({ path: ["creditBatchId"] })] } });
      expect(await sampleRows(f)).toEqual([]);
    }
  });

  it.each([["create first", true], ["batch delete first", false]] as const)("create against a credit batch delete: %s", async (_label, createFirst) => {
    const f = await fixture();
    const version = await labLogisticsVersion(f.ctx, "creditBatches", f.batchA.id);
    const create = () => runOperation(recordLabSample, f.ctx, input(f), { pool: writerPool });
    const removeBatch = () => deleteCreditBatch(f.ctx, f.batchA.id, version);
    const [first, second] = await queueOnBatch(f, createFirst ? [create, removeBatch] : [removeBatch, create]);
    expect(first.ok).toBe(true);
    if (createFirst) {
      // Batch deletion unlinks the sample it found, as it always has.
      expect(second.ok).toBe(true);
      expect(await sampleRows(f)).toMatchObject([{ creditBatchId: null }]);
    } else {
      expect(second).toMatchObject({ ok: false, error: { code: "not_found", message: BATCH_NOT_FOUND } });
      expect(await sampleRows(f)).toEqual([]);
    }
  });

  it.each([["leg first", true], ["sample delete first", false]] as const)("transport leg create against sample delete: %s, never an orphan leg", async (_label, legFirst) => {
    const f = await fixture();
    const created = (await runOperation(recordLabSample, f.ctx, input(f))).data.sample;
    const leg = () => createTransportLeg(f.ctx, { entityType: "sample", entityId: created.id, distanceKm: 10, loadMassKg: 1,
      transportMethodType: "road", calculationMethodType: "distance_based" });
    const remove = () => runOperation(deleteLabSample, f.ctx, { labSampleId: created.id, expectedVersion: 1 }, { pool: writerPool });
    const [first, second] = await queueOnBatch(f, legFirst ? [leg, remove] : [remove, leg]);
    expect(first.ok).toBe(true);
    if (legFirst) {
      // The delete took the leg with the sample.
      expect(second.ok).toBe(true);
    } else {
      expect(second).toMatchObject({ ok: false, error: { message: SAMPLE_NOT_FOUND } });
    }
    expect(await sampleRows(f)).toEqual([]);
    expect(await db.select().from(transportLegs).where(eq(transportLegs.organizationId, f.ctx.organizationId))).toEqual([]);
  });

  it.each([["batch edit first", true], ["create first", false]] as const)("create against a batch edit that moves the start past the sampling time: %s", async (_label, editFirst) => {
    // R1 ran on 2026-09-09, so it stays inside the edited window; batch B is left out to keep R2 free.
    const f = await fixture({ withSecondBatch: false });
    const version = await labLogisticsVersion(f.ctx, "creditBatches", f.batchA.id);
    const create = () => runOperation(recordLabSample, f.ctx, { ...input(f), samplingTime: "2026-09-05T08:00:00Z" }, { pool: writerPool });
    const edit = () => updateCreditBatch(f.ctx, f.batchA.id, { expectedVersion: version, startDate: new Date("2026-09-08") });
    const [first, second] = await queueOnBatch(f, editFirst ? [edit, create] : [create, edit]);
    expect(first.ok).toBe(true);
    if (editFirst) {
      // The create reads the edited window under the batch lock.
      expect(second).toMatchObject({ ok: false, error: { code: "validation_failed", issues: [expect.objectContaining({ path: ["samplingTime"] })] } });
      expect(await sampleRows(f)).toEqual([]);
    } else {
      // Q55: the edit stays allowed; readiness flags the earlier sample.
      expect(second.ok).toBe(true);
      expect(await sampleRows(f)).toHaveLength(1);
    }
  });

  it.each([["update first", true], ["archive first", false]] as const)("update against a facility archive: %s", async (_label, updateFirst) => {
    const f = await fixture();
    const created = (await runOperation(recordLabSample, f.ctx, input(f))).data.sample;
    const update = () => runOperation(updateLabSample, f.ctx, { labSampleId: created.id, expectedVersion: 1, labName: "Edit" }, { pool: writerPool });
    const archive = async () => archiveFacility(f.ctx, f.facility.id, await masterDataVersion(f.ctx, "facilities", f.facility.id));
    const [first, second] = await queueOnBatch(f, updateFirst ? [update, archive] : [archive, update]);
    expect(first.ok).toBe(true);
    if (updateFirst) {
      expect(second.ok).toBe(true);
      expect(await sampleRows(f)).toMatchObject([{ version: 2, labName: "Edit" }]);
    } else {
      expect(second).toMatchObject({ ok: false, error: { code: "not_found", issues: [expect.objectContaining({ path: ["creditBatchId"] })] } });
      expect(await sampleRows(f)).toMatchObject([{ version: 1, labName: null }]);
    }
  });

  it.each([["delete first", true], ["archive first", false]] as const)("delete against a facility archive: %s, both succeed", async (_label, deleteFirst) => {
    const f = await fixture();
    const created = (await runOperation(recordLabSample, f.ctx, input(f))).data.sample;
    const remove = () => runOperation(deleteLabSample, f.ctx, { labSampleId: created.id, expectedVersion: 1 }, { pool: writerPool });
    const archive = async () => archiveFacility(f.ctx, f.facility.id, await masterDataVersion(f.ctx, "facilities", f.facility.id));
    const outcomes = await queueOnBatch(f, deleteFirst ? [remove, archive] : [archive, remove]);
    expect(outcomes.map((outcome) => outcome.ok)).toEqual([true, true]);
    expect(await sampleRows(f)).toEqual([]);
  });
});
