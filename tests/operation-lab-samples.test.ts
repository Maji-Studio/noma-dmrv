/**
 * Lab sample operations on the runner (Phase 5a commit 2), at pool size one
 * so a global `db` read inside the write path would wait on itself. Covers
 * the create, update and delete outcomes, the batch checks read under the
 * batch lock, lineage refusals including a Removal assigned while the writer
 * waits, the facility clock, and the derived ratios and warnings.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.hoisted(() => {
  process.env.DB_POOL_MAX = "1";
  // Barrier tests hold a batch lock across writers; the pooled default (1 s) would abort them.
  process.env.DB_POOL_LOCK_TIMEOUT_MS = "5000";
});
import { and, eq } from "drizzle-orm";
import type { Pool } from "pg";
import { db } from "@/db";
import { creditBatches, documents, facilities, samples, transportLegs } from "@/db/schema";
import { getBatchesWithLabReports } from "@/data-access/sample-document-evidence";
import { generateNextCodes } from "@/data-access/code-generator";
import { updateCreditBatch } from "@/data-access/credit-batches";
import { createTransportLeg } from "@/data-access/transport-legs";
import { loadDurabilityBatchData } from "@/fn/certification/durability-readiness";
import { deriveSampleRatios } from "@/lib/calculations/sample-ratios";
import { deleteLabSample, recordLabSample, updateLabSample } from "@/lib/operations/lab-samples";
import { runOperation, runOperationInProcess } from "@/lib/operations/runner";
import { SafeError } from "@/lib/errors";
import { __setStorageProviderForTests } from "@/lib/storage";
import { LINEAGE_LOCKED_COPY } from "./helpers/certified-output-lineage";
import { insertManagedDocument, RetirementStorageProvider } from "./helpers/document-retirement";
import { assignRemoval, cleanupLabSampleFixture, createLabSampleFixture, type LabSampleBatch, type LabSampleFixture, type LabSampleFixtureOptions } from "./helpers/lab-sample-fixture";
import { labLogisticsVersion } from "./helpers/lab-logistics-version";
import { openOperationBarrier, waitForBlockedOperations } from "./helpers/operation-barrier";
import { createTestPool } from "./helpers/operation-fixture";

const SUITE_TIMEOUT_MS = 60_000;
const NO_SELF_WAIT_MS = 5_000;
const BARRIER_POOL_SIZE = 3;
const HOUR_MS = 3_600_000;
const IN_WINDOW = "2026-09-10T08:00:00Z";
/** The writers' copy as SafeError normalizes it for the operator. */
const SAMPLE_NOT_FOUND = new SafeError("Sample not found").message;
const BATCH_NOT_FOUND = new SafeError("Credit batch not found").message;
const LINEAGE_CHANGED = "Certification lineage changed while it was being locked. Refresh and retry.";
const TIER_1000_EVIDENCE = { randomReflectanceR0Percent: 2.4, sReflectanceFraction: 0.92, residualCarbonPercent: 65 };

let barrierPool: Pool;
const fixtures: LabSampleFixture[] = [];

beforeAll(() => { barrierPool = createTestPool(BARRIER_POOL_SIZE); });
afterEach(async () => {
  __setStorageProviderForTests(null);
  for (const f of fixtures.splice(0)) await cleanupLabSampleFixture(f);
});
afterAll(async () => { await barrierPool.end(); });

async function fixture(options?: LabSampleFixtureOptions) {
  const f = await createLabSampleFixture(options);
  fixtures.push(f);
  return f;
}

function input(f: LabSampleFixture, changes: Record<string, unknown> = {}) {
  return {
    creditBatchId: f.batchA.id, samplingTime: IN_WINDOW, totalCarbonPercent: 80, organicCarbonPercent: 75,
    totalHydrogenPercent: 1.5, moistureContentPercent: 10, ...changes,
  };
}

const record = (f: LabSampleFixture, changes: Record<string, unknown> = {}) => runOperation(recordLabSample, f.ctx, input(f, changes));
const sampleRows = (f: LabSampleFixture) => db.select().from(samples).where(eq(samples.organizationId, f.ctx.organizationId));
const legRows = (f: LabSampleFixture) => db.select().from(transportLegs).where(eq(transportLegs.organizationId, f.ctx.organizationId));
const locked = (message: unknown = expect.stringContaining(LINEAGE_LOCKED_COPY)) => ({ code: "certification_locked", message });
const onField = (field: string, code = "validation_failed") => ({ code, issues: [expect.objectContaining({ path: [field] })] });

describe("lab sample operations", { timeout: SUITE_TIMEOUT_MS }, () => {
  it("creates, updates and deletes through the runner without waiting on its own connection", async () => {
    const f = await fixture();
    expect(db.$client.options.max).toBe(1);
    const started = Date.now();
    const created = await record(f);
    expect(created.data.sample).toMatchObject({ creditBatchId: f.batchA.id, version: 1, samplingTime: new Date(IN_WINDOW).toISOString() });
    expect(created.data.sample.sampleCode).toMatch(/^SAM-\d{2}-\d{3,}$/);
    expect(created.effect).toMatchObject({ outcome: "created", entityType: "labSample", entityIds: [created.data.sample.id] });

    const updated = await runOperation(updateLabSample, f.ctx, { labSampleId: created.data.sample.id, expectedVersion: 1, labName: "Soil Lab", code: "SAM-LAB-EDIT" });
    expect(updated.data.sample).toMatchObject({ labName: "Soil Lab", sampleCode: "SAM-LAB-EDIT", version: 2 });
    await expect(runOperation(updateLabSample, f.ctx, { labSampleId: created.data.sample.id, expectedVersion: 1, labName: "Late" }))
      .rejects.toMatchObject({ code: "stale_version", conflict: { entity: "sample", id: created.data.sample.id } });

    await runOperation(deleteLabSample, f.ctx, { labSampleId: created.data.sample.id, expectedVersion: 2 });
    expect(await sampleRows(f)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(NO_SELF_WAIT_MS);
  });

  it("answers a missing Sample with not_found on update and delete", async () => {
    const f = await fixture();
    const missing = { labSampleId: "00000000-0000-4000-8000-000000000099", expectedVersion: 1 };
    await expect(runOperation(updateLabSample, f.ctx, { ...missing, labName: "x" })).rejects.toMatchObject({ code: "not_found", message: SAMPLE_NOT_FOUND });
    await expect(runOperation(deleteLabSample, f.ctx, missing)).rejects.toMatchObject({ code: "not_found", message: SAMPLE_NOT_FOUND });
  });

  it("rolls a dry-run create, update and delete back", async () => {
    const f = await fixture();
    const preview = await runOperation(recordLabSample, f.ctx, input(f), { dryRun: true });
    expect(preview.dryRun).toBe(true);
    expect(preview.data.sample.creditBatchId).toBe(f.batchA.id);
    expect(await sampleRows(f)).toEqual([]);

    const created = (await record(f)).data.sample;
    await runOperation(updateLabSample, f.ctx, { labSampleId: created.id, expectedVersion: 1, labName: "Preview" }, { dryRun: true });
    await runOperation(deleteLabSample, f.ctx, { labSampleId: created.id, expectedVersion: 1 }, { dryRun: true });
    expect(await sampleRows(f)).toMatchObject([{ id: created.id, version: 1, labName: null }]);
  });
});

describe("codes", { timeout: SUITE_TIMEOUT_MS }, () => {
  it("retries a generated code another writer takes while the create runs", async () => {
    const f = await fixture();
    const [taken] = await generateNextCodes(f.ctx, "SAM", samples, samples.sampleCode, 1);
    const barrier = await openOperationBarrier(barrierPool);
    let pending: ReturnType<typeof record> | undefined;
    try {
      // Batchless, so the competitor holds no key-share lock on the batch: the create waits on the code alone.
      await barrier.tx.insert(samples).values({ organizationId: f.ctx.organizationId, sampleCode: taken,
        samplingTime: new Date(IN_WINDOW), totalCarbonPercent: 80, organicCarbonPercent: 75 });
      pending = record(f);
      await waitForBlockedOperations(barrierPool, barrier.pid, 1);
      await barrier.commit();
    } catch (error) {
      await barrier.rollback();
      await Promise.allSettled([pending]);
      throw error;
    }
    const created = (await pending!).data.sample;
    expect(created.sampleCode).not.toBe(taken);
    expect((await sampleRows(f)).map((row) => row.sampleCode).sort()).toEqual([taken, created.sampleCode].sort());
  });

  it("answers an edited duplicate code with conflict on /code and the form's copy", async () => {
    const f = await fixture();
    const first = (await record(f)).data.sample;
    const second = (await record(f)).data.sample;
    await expect(runOperation(updateLabSample, f.ctx, { labSampleId: second.id, expectedVersion: 1, code: first.sampleCode }))
      .rejects.toMatchObject({ code: "conflict", message: "A Sample with this code already exists.", issues: [expect.objectContaining({ path: ["code"] })] });
  });
});

describe("credit batch checks read under the batch lock", { timeout: SUITE_TIMEOUT_MS }, () => {
  async function archive(f: LabSampleFixture, batch: LabSampleBatch) {
    await db.update(creditBatches).set({ archivedAt: new Date() })
      .where(and(eq(creditBatches.id, batch.id), eq(creditBatches.organizationId, f.ctx.organizationId)));
  }

  it("refuses an archived batch on create, update and move with not_found on /creditBatchId", async () => {
    const f = await fixture();
    const onA = (await record(f)).data.sample;
    await archive(f, f.batchB!);
    await expect(record(f, { creditBatchId: f.batchB!.id, samplingTime: "2026-08-10T08:00:00Z" })).rejects.toMatchObject(onField("creditBatchId", "not_found"));
    await expect(runOperation(updateLabSample, f.ctx, { labSampleId: onA.id, expectedVersion: 1, creditBatchId: f.batchB!.id }))
      .rejects.toMatchObject(onField("creditBatchId", "not_found"));
    await archive(f, f.batchA);
    await expect(runOperation(updateLabSample, f.ctx, { labSampleId: onA.id, expectedVersion: 1, labName: "Edit" }))
      .rejects.toMatchObject({ code: "not_found", message: `Credit batch ${f.batchA.code} is archived. Choose an active credit batch.` });
    expect(await sampleRows(f)).toMatchObject([{ id: onA.id, version: 1, creditBatchId: f.batchA.id }]);
  });

  it("refuses a move off an archived batch, and still allows deleting a sample there", async () => {
    const f = await fixture();
    const onA = (await record(f)).data.sample;
    await archive(f, f.batchA);
    await expect(runOperation(updateLabSample, f.ctx, { labSampleId: onA.id, expectedVersion: 1, creditBatchId: f.batchB!.id, samplingTime: "2026-08-10T08:00:00Z" }))
      .rejects.toMatchObject({ ...onField("creditBatchId", "not_found"), message: `Credit batch ${f.batchA.code} is archived. Choose an active credit batch.` });
    expect(await sampleRows(f)).toMatchObject([{ id: onA.id, version: 1, creditBatchId: f.batchA.id }]);
    await runOperation(deleteLabSample, f.ctx, { labSampleId: onA.id, expectedVersion: 1 });
    expect(await sampleRows(f)).toEqual([]);
  });

  it("answers another organization's batch with not_found on /creditBatchId and no side effect", async () => {
    const f = await fixture();
    const other = await fixture({ withSecondBatch: false });
    await expect(record(f, { creditBatchId: other.batchA.id })).rejects.toMatchObject({ ...onField("creditBatchId", "not_found"), message: BATCH_NOT_FOUND });
    const onA = (await record(f)).data.sample;
    await expect(runOperation(updateLabSample, f.ctx, { labSampleId: onA.id, expectedVersion: 1, creditBatchId: other.batchA.id }))
      .rejects.toMatchObject(onField("creditBatchId", "not_found"));
    expect(await sampleRows(f)).toMatchObject([{ id: onA.id, version: 1, creditBatchId: f.batchA.id }]);
    expect(await sampleRows(other)).toEqual([]);
  });

  it("puts the window's lower bound on the facility's calendar day", async () => {
    // Dar es Salaam is UTC+3: 21:00Z on Aug 31 is 00:00 on Sep 1, the batch's first day.
    const f = await fixture({ timeZone: "Africa/Dar_es_Salaam" });
    await expect(record(f, { samplingTime: "2026-08-31T20:59:00Z" })).rejects.toMatchObject({
      ...onField("samplingTime"),
      message: `Sample date 2026-08-31 is before credit batch ${f.batchA.code}'s production window, 2026-09-01 to 2026-09-30. Choose a date within or after the production window.`,
    });
    expect((await record(f, { samplingTime: "2026-08-31T21:00:00Z" })).data.sample.samplingTime).toBe("2026-08-31T21:00:00.000Z");
    const local = await record(f, { samplingTime: { date: "2026-09-01", time: "00:30" } });
    expect(local.data.sample.samplingTime).toBe("2026-08-31T21:30:00.000Z");
    // Moving a sample onto a later batch re-checks the window on the stored time.
    const onB = (await record(f, { creditBatchId: f.batchB!.id, samplingTime: "2026-08-10T08:00:00Z" })).data.sample;
    await expect(runOperation(updateLabSample, f.ctx, { labSampleId: onB.id, expectedVersion: 1, creditBatchId: f.batchA.id }))
      .rejects.toMatchObject(onField("samplingTime"));
  });

  it("refuses a sampling time in the future", async () => {
    const f = await fixture();
    const future = new Date(Date.now() + HOUR_MS).toISOString();
    await expect(record(f, { samplingTime: future })).rejects.toMatchObject(onField("samplingTime"));
    const created = (await record(f)).data.sample;
    await expect(runOperation(updateLabSample, f.ctx, { labSampleId: created.id, expectedVersion: 1, samplingTime: future }))
      .rejects.toMatchObject(onField("samplingTime"));
  });

  it("refuses a facility-local time in a DST gap or fold rather than guessing", async () => {
    // An Isometric batch spans at most one month, so each clock change gets a batch of its own.
    // 2026-03-29 02:30 never happens in Berlin; 2025-10-26 02:30 happens twice.
    const spring = await fixture({ timeZone: "Europe/Berlin", window: { startDate: "2026-03-01", endDate: "2026-03-31" } });
    await expect(record(spring, { samplingTime: { date: "2026-03-29", time: "02:30" } })).rejects.toMatchObject(onField("samplingTime"));
    expect((await record(spring, { samplingTime: { date: "2026-03-29", time: "03:30" } })).data.sample.samplingTime).toBe("2026-03-29T01:30:00.000Z");
    const autumn = await fixture({ timeZone: "Europe/Berlin", window: { startDate: "2025-10-01", endDate: "2025-10-31" } });
    await expect(record(autumn, { samplingTime: { date: "2025-10-26", time: "02:30" } })).rejects.toMatchObject(onField("samplingTime"));
    expect((await record(autumn, { samplingTime: { date: "2025-10-26", time: "03:30" } })).data.sample.samplingTime).toBe("2025-10-26T02:30:00.000Z");
    expect(await sampleRows(spring)).toHaveLength(1);
    expect(await sampleRows(autumn)).toHaveLength(1);
  });

  it("refuses when the batch facility has no time zone, never reading it as UTC", async () => {
    const f = await fixture();
    await db.update(facilities).set({ timezone: "" }).where(and(eq(facilities.id, f.facility.id), eq(facilities.organizationId, f.ctx.organizationId)));
    for (const samplingTime of [{ date: "2026-09-10", time: "08:00" }, IN_WINDOW]) {
      await expect(record(f, { samplingTime })).rejects.toMatchObject({
        ...onField("samplingTime"), message: `Credit batch ${f.batchA.code}'s facility has no time zone. Set the facility time zone, then save the Sample again.`,
      });
    }
    expect(await sampleRows(f)).toEqual([]);
  });
});

describe("certification lineage", { timeout: SUITE_TIMEOUT_MS }, () => {
  it("refuses create, update, move (source and target) and delete under a submitted lineage", async () => {
    const f = await fixture();
    const onA = (await record(f)).data.sample;
    const onB = (await record(f, { creditBatchId: f.batchB!.id, samplingTime: "2026-08-10T08:00:00Z" })).data.sample;
    await assignRemoval(f, f.batchA, { submitted: true });
    await expect(record(f)).rejects.toMatchObject(locked());
    await expect(runOperation(updateLabSample, f.ctx, { labSampleId: onA.id, expectedVersion: 1, labName: "x" })).rejects.toMatchObject(locked());
    // Move off the locked source, and onto the locked target.
    await expect(runOperation(updateLabSample, f.ctx, { labSampleId: onA.id, expectedVersion: 1, creditBatchId: f.batchB!.id })).rejects.toMatchObject(locked());
    await expect(runOperation(updateLabSample, f.ctx, { labSampleId: onB.id, expectedVersion: 1, creditBatchId: f.batchA.id, samplingTime: IN_WINDOW }))
      .rejects.toMatchObject(locked(expect.stringContaining("selected credit batch")));
    await expect(runOperation(deleteLabSample, f.ctx, { labSampleId: onA.id, expectedVersion: 1 })).rejects.toMatchObject(locked());
    expect((await sampleRows(f)).map((row) => [row.id, row.version, row.creditBatchId]).sort())
      .toEqual([[onA.id, 1, f.batchA.id], [onB.id, 1, f.batchB!.id]].sort());
  });

  it("allows writes while the Removal is assigned but not submitted", async () => {
    const f = await fixture();
    await assignRemoval(f, f.batchA, { submitted: false });
    const created = (await record(f)).data.sample;
    await runOperation(deleteLabSample, f.ctx, { labSampleId: created.id, expectedVersion: 1 });
  });

  /** Assigns and submits `batch`'s Removal inside a barrier holding its row while `write` waits. */
  async function assignedWhileWaiting(f: LabSampleFixture, batch: LabSampleBatch, write: () => Promise<unknown>) {
    const barrier = await openOperationBarrier(barrierPool);
    let pending: Promise<unknown> | undefined;
    try {
      await barrier.tx.select({ id: creditBatches.id }).from(creditBatches)
        .where(and(eq(creditBatches.id, batch.id), eq(creditBatches.organizationId, f.ctx.organizationId))).for("update");
      await assignRemoval(f, batch, { submitted: true, executor: barrier.tx });
      pending = write();
      // The writer found no artifact, so it now waits on the batch row.
      await waitForBlockedOperations(barrierPool, barrier.pid, 1);
      await barrier.commit();
    } catch (error) {
      await barrier.rollback();
      await Promise.allSettled([pending]);
      throw error;
    }
    return pending!;
  }

  it("refuses a create when the batch's lineage is assigned while it waits on the batch lock", async () => {
    const f = await fixture();
    await expect(assignedWhileWaiting(f, f.batchA, () => record(f))).rejects.toMatchObject(locked(LINEAGE_CHANGED));
    expect(await sampleRows(f)).toEqual([]);
  });

  it("refuses an update when the batch's lineage is assigned while it waits", async () => {
    const f = await fixture();
    const created = (await record(f)).data.sample;
    await expect(assignedWhileWaiting(f, f.batchA, () => runOperation(updateLabSample, f.ctx, { labSampleId: created.id, expectedVersion: 1, labName: "x" })))
      .rejects.toMatchObject(locked(LINEAGE_CHANGED));
    expect(await sampleRows(f)).toMatchObject([{ version: 1, labName: null }]);
  });

  it("refuses a move when the target batch's lineage is assigned while it waits", async () => {
    const f = await fixture();
    const onB = (await record(f, { creditBatchId: f.batchB!.id, samplingTime: "2026-08-10T08:00:00Z" })).data.sample;
    const move = () => runOperation(updateLabSample, f.ctx, { labSampleId: onB.id, expectedVersion: 1, creditBatchId: f.batchA.id, samplingTime: IN_WINDOW });
    await expect(assignedWhileWaiting(f, f.batchA, move)).rejects.toMatchObject(locked(LINEAGE_CHANGED));
    expect(await sampleRows(f)).toMatchObject([{ id: onB.id, creditBatchId: f.batchB!.id, version: 1 }]);
  });

  it("refuses a delete when the lineage is assigned while it waits", async () => {
    const f = await fixture();
    const created = (await record(f)).data.sample;
    await expect(assignedWhileWaiting(f, f.batchA, () => runOperation(deleteLabSample, f.ctx, { labSampleId: created.id, expectedVersion: 1 })))
      .rejects.toMatchObject(locked(LINEAGE_CHANGED));
    expect(await sampleRows(f)).toHaveLength(1);
  });
});

describe("certification lineage of children and legacy links", { timeout: SUITE_TIMEOUT_MS }, () => {
  /** Holds `batch` and assigns its submitted Removal; `write` must queue behind the barrier. */
  async function assignWhileQueued(f: LabSampleFixture, batch: LabSampleBatch, write: () => Promise<unknown>) {
    const barrier = await openOperationBarrier(barrierPool);
    let pending: Promise<unknown> | undefined;
    try {
      await barrier.tx.select({ id: creditBatches.id }).from(creditBatches)
        .where(and(eq(creditBatches.id, batch.id), eq(creditBatches.organizationId, f.ctx.organizationId))).for("update");
      await assignRemoval(f, batch, { submitted: true, executor: barrier.tx });
      pending = write();
      await waitForBlockedOperations(barrierPool, barrier.pid, 1);
      await barrier.commit();
    } catch (error) {
      await barrier.rollback();
      await Promise.allSettled([pending]);
      throw error;
    }
    return pending!;
  }

  it("refuses a transport leg when the Sample's lineage is assigned while the leg waits", async () => {
    const f = await fixture();
    const created = (await record(f)).data.sample;
    const leg = () => createTransportLeg(f.ctx, { entityType: "sample", entityId: created.id, distanceKm: 10, loadMassKg: 1,
      transportMethodType: "road", calculationMethodType: "distance_based" });
    await expect(assignWhileQueued(f, f.batchA, leg)).rejects.toThrow(LINEAGE_CHANGED);
    expect(await legRows(f)).toEqual([]);
  });

  /** A pre-re-grain row: on batch A directly, with its legacy run in batch B. */
  async function legacySample(f: LabSampleFixture) {
    const [row] = await db.insert(samples).values({ organizationId: f.ctx.organizationId, sampleCode: `E2E-LAB-LEGACY-${f.tag}`,
      creditBatchId: f.batchA.id, productionRunId: f.batchB!.runId, samplingTime: new Date(IN_WINDOW),
      totalCarbonPercent: 80, organicCarbonPercent: 75 }).returning();
    return row;
  }

  it("locks the batch a legacy run link reaches, so its lineage cannot be assigned under an update", async () => {
    const f = await fixture();
    const legacy = await legacySample(f);
    const update = () => runOperation(updateLabSample, f.ctx, { labSampleId: legacy.id, expectedVersion: 1, labName: "x" });
    await expect(assignWhileQueued(f, f.batchB!, update)).rejects.toMatchObject(locked(LINEAGE_CHANGED));
    expect(await sampleRows(f)).toMatchObject([{ id: legacy.id, version: 1, labName: null }]);
  });

  it("locks the batch a legacy run link reaches on delete too", async () => {
    const f = await fixture();
    const legacy = await legacySample(f);
    const remove = () => runOperation(deleteLabSample, f.ctx, { labSampleId: legacy.id, expectedVersion: 1 });
    await expect(assignWhileQueued(f, f.batchB!, remove)).rejects.toMatchObject(locked(LINEAGE_CHANGED));
    expect(await sampleRows(f)).toHaveLength(1);
  });
});

describe("ratios", { timeout: SUITE_TIMEOUT_MS }, () => {
  it("stores H/C_org byte for byte as the form calculates it and says it was calculated", async () => {
    const f = await fixture();
    const values = { totalHydrogenPercent: 1.73, totalOxygenPercent: 6.2, organicCarbonPercent: 74.6 };
    const form = deriveSampleRatios({ ...values, oToCOrgRatio: null });
    const created = await record(f, values);
    expect(created.data.sample.hToCOrgRatio).toBe(form.hToCOrgRatio);
    expect(created.data.sample.oToCOrgRatio).toBe(form.oToCOrgRatio);
    expect(created.data.notices).toEqual(form.notices);
    expect(created.data.notices[0].message).toMatch(/^H\/C_org calculated from hydrogen and organic carbon: \d\.\d{4}$/);
  });

  it("recomputes from the merged locked row on PATCH", async () => {
    const f = await fixture();
    const created = (await record(f, { totalOxygenPercent: 6 })).data.sample;
    const cleared = (await runOperation(updateLabSample, f.ctx, { labSampleId: created.id, expectedVersion: 1, totalHydrogenPercent: null })).data;
    expect(cleared.sample).toMatchObject({ totalHydrogenPercent: null, hToCOrgRatio: null });
    expect(cleared.sample.oToCOrgRatio).toBe(created.oToCOrgRatio);
    const oxygen = (await runOperation(updateLabSample, f.ctx, { labSampleId: created.id, expectedVersion: 2, totalOxygenPercent: 9 })).data.sample;
    expect(oxygen.oToCOrgRatio).toBe(deriveSampleRatios({ totalHydrogenPercent: null, totalOxygenPercent: 9, organicCarbonPercent: 75, oToCOrgRatio: null }).oToCOrgRatio);
    // An organic carbon edit alone recomputes both from the stored hydrogen and oxygen.
    const organic = (await runOperation(updateLabSample, f.ctx, { labSampleId: created.id, expectedVersion: 3, totalHydrogenPercent: 1.5, organicCarbonPercent: 70 })).data.sample;
    expect(organic.hToCOrgRatio).toBe(deriveSampleRatios({ totalHydrogenPercent: 1.5, totalOxygenPercent: 9, organicCarbonPercent: 70, oToCOrgRatio: null }).hToCOrgRatio);
  });

  it("keeps a lab O/C_org only without oxygen", async () => {
    const f = await fixture();
    const lab = (await record(f, { oToCOrgRatio: 0.15 })).data.sample;
    expect(lab.oToCOrgRatio).toBe(0.15);
    const withOxygen = (await record(f, { oToCOrgRatio: 0.15, totalOxygenPercent: 6 })).data.sample;
    expect(withOxygen.oToCOrgRatio).toBe(deriveSampleRatios({ totalHydrogenPercent: 1.5, totalOxygenPercent: 6, organicCarbonPercent: 75, oToCOrgRatio: 0.15 }).oToCOrgRatio);
    expect(withOxygen.oToCOrgRatio).not.toBe(0.15);
    // Clearing oxygen drops the calculated O/C_org; it never survives as a lab figure.
    const cleared = (await runOperation(updateLabSample, f.ctx, { labSampleId: withOxygen.id, expectedVersion: 1, totalOxygenPercent: null })).data.sample;
    expect(cleared.oToCOrgRatio).toBeNull();
    // A lab ratio edit on the oxygen-free sample is kept.
    const edited = (await runOperation(updateLabSample, f.ctx, { labSampleId: lab.id, expectedVersion: 1, oToCOrgRatio: 0.12 })).data.sample;
    expect(edited.oToCOrgRatio).toBe(0.12);
  });

  it("refuses a calculated ratio above the stored maximum on the input behind it", async () => {
    const f = await fixture();
    // (H / 1.008) / (1 / 12.011) rounds to 10.0000, above numeric(7,6).
    const hydrogen = 9.99996 * 1.008 / 12.011;
    await expect(record(f, { totalHydrogenPercent: hydrogen, organicCarbonPercent: 1 })).rejects.toMatchObject(onField("totalHydrogenPercent"));
    const created = (await record(f)).data.sample;
    await expect(runOperation(updateLabSample, f.ctx, { labSampleId: created.id, expectedVersion: 1, totalHydrogenPercent: hydrogen, organicCarbonPercent: 1 }))
      .rejects.toMatchObject(onField("totalHydrogenPercent"));
  });
});

const missingReport = (f: LabSampleFixture) =>
  `Credit batch ${f.batchA.code} has no lab report document. Upload a lab report to a Sample or the credit batch. You can still submit the Removal.`;

describe("warnings", { timeout: SUITE_TIMEOUT_MS }, () => {
  it("counts only uploaded, org-scoped lab reports on the batch or its Samples", async () => {
    const f = await fixture();
    const other = await fixture();
    const sample = (await record(f)).data.sample;
    const [pending, foreign] = await db.insert(documents).values([
      { organizationId: f.ctx.organizationId, entityType: "sample", entityId: sample.id,
        documentType: "lab_report", fileName: "report.pdf", storageProvider: "local-fs", storageBucket: "local-fs", storageKey: `sample/${sample.id}/report.pdf`, fileUrl: "https://example.test/report.pdf", uploadStatus: "pending" as const },
      { organizationId: other.ctx.organizationId, entityType: "credit_batch", entityId: f.batchA.id,
        documentType: "lab_report", fileName: "report.pdf", fileUrl: "https://example.test/foreign-report.pdf", uploadStatus: "uploaded" as const },
    ]).returning({ id: documents.id });
    try {
      expect(await getBatchesWithLabReports(f.ctx, [f.batchA.id])).toEqual(new Set());
      await db.update(documents).set({ uploadStatus: "uploaded" }).where(and(eq(documents.id, pending.id), eq(documents.organizationId, f.ctx.organizationId)));
      expect(await getBatchesWithLabReports(f.ctx, [f.batchA.id])).toEqual(new Set([f.batchA.id]));
      await db.update(documents).set({ entityType: "credit_batch", entityId: f.batchA.id }).where(and(eq(documents.id, pending.id), eq(documents.organizationId, f.ctx.organizationId)));
      expect(await getBatchesWithLabReports(f.ctx, [f.batchA.id])).toEqual(new Set([f.batchA.id]));
    } finally {
      await db.delete(documents).where(and(eq(documents.id, pending.id), eq(documents.organizationId, f.ctx.organizationId)));
      await db.delete(documents).where(and(eq(documents.id, foreign.id), eq(documents.organizationId, other.ctx.organizationId)));
    }
  });

  it("saves and clears s_fraction on a 1,000-year Sample, warning that certification still needs it", async () => {
    const f = await fixture({ durabilityOption: "1000_year" });
    const created = await record(f, { sReflectanceFraction: undefined,
      inorganicCarbonPercent: 3, totalOxygenPercent: 6, r0MeasurementCount: 500 });
    expect(created.data.sample.sReflectanceFraction).toBeNull();
    expect(created.data.warnings).toEqual([
      missingReport(f),
      `Sample ${created.data.sample.sampleCode} is missing the R₀ fraction at or above 2%. A 1,000-year Removal with credit batch ${f.batchA.code} cannot be submitted until every Sample has it.`,
    ]);
    const filled = await runOperation(updateLabSample, f.ctx, {
      labSampleId: created.data.sample.id, expectedVersion: 1, sReflectanceFraction: 0.92,
    });
    expect(filled.data.warnings).toEqual([missingReport(f)]);
    const cleared = await runOperation(updateLabSample, f.ctx, {
      labSampleId: created.data.sample.id, expectedVersion: 2, sReflectanceFraction: null,
    });
    expect(cleared.data.sample.sReflectanceFraction).toBeNull();
    expect(cleared.data.warnings).toEqual(created.data.warnings);
  });

  it("warns on a 1,000-year batch for missing inorganic carbon and under 500 R₀ readings, and still saves", async () => {
    const f = await fixture({ durabilityOption: "1000_year" });
    const created = await record(f, { ...TIER_1000_EVIDENCE, totalOxygenPercent: 6, r0MeasurementCount: 120 });
    const code = created.data.sample.sampleCode;
    expect(created.data.warnings).toEqual([
      missingReport(f),
      `Sample ${code} is missing measured inorganic carbon. A 1,000-year Removal with credit batch ${f.batchA.code} cannot be submitted until every Sample has it.`,
      `Sample ${code} has 120 R₀ measurements. For 1,000-year crediting the biochar module asks for at least 500 per Sample. You can still submit the Removal.`,
    ]);
    const complete = await runOperation(updateLabSample, f.ctx, { labSampleId: created.data.sample.id, expectedVersion: 1, inorganicCarbonPercent: 3, r0MeasurementCount: 500 });
    expect(complete.data.warnings).toEqual([missingReport(f)]);
  });

  it("warns on any tier when hydrogen or moisture is missing", async () => {
    const f = await fixture();
    const created = await record(f, { totalHydrogenPercent: undefined, moistureContentPercent: undefined });
    // Without hydrogen or oxygen the Sample also lacks both ratios gate (c) counts.
    expect(created.data.warnings).toHaveLength(4);
    expect(created.data.warnings.join(" ")).toMatch(/no total hydrogen.*no moisture content.*no H\/C_org and O\/C_org/);
  });

  it("warns when a saved Sample has no O/C_org, then stops once oxygen is entered", async () => {
    const f = await fixture();
    const created = await record(f);
    const code = created.data.sample.sampleCode;
    expect(created.data.sample.oToCOrgRatio).toBeNull();
    expect(created.data.warnings).toEqual([
      missingReport(f),
      `Sample ${code} has no O/C_org, so it is not one of the 3 Samples with complete H/C_org and O/C_org results credit batch ${f.batchA.code} needs before submitting. Enter total oxygen, or the lab's O/C_org when the lab reported no oxygen.`,
    ]);
    const withOxygen = await runOperation(updateLabSample, f.ctx, { labSampleId: created.data.sample.id, expectedVersion: 1, totalOxygenPercent: 6 });
    expect(withOxygen.data.warnings).toEqual([missingReport(f)]);
  });

  it("warns when zero organic carbon leaves both ratios empty", async () => {
    const f = await fixture();
    const created = await record(f, { organicCarbonPercent: 0, totalOxygenPercent: 6 });
    expect(created.data.sample).toMatchObject({ hToCOrgRatio: null, oToCOrgRatio: null });
    expect(created.data.warnings).toEqual([
      missingReport(f),
      `Sample ${created.data.sample.sampleCode} has no H/C_org and O/C_org, so it is not one of the 3 Samples with complete H/C_org and O/C_org results credit batch ${f.batchA.code} needs before submitting. With organic carbon at 0, neither ratio can be calculated. Check the organic carbon value.`,
    ]);
  });
});

describe("delete", { timeout: SUITE_TIMEOUT_MS }, () => {
  it("retires the lab report and the transport legs, draining storage only after commit and never on a dry run", async () => {
    const f = await fixture();
    const provider = new RetirementStorageProvider();
    __setStorageProviderForTests(provider);
    const created = (await record(f)).data.sample;
    const key = `sample/${created.id}/pdf/lab-report.pdf`;
    await insertManagedDocument(provider, "sample", created.id, key, f.ctx.organizationId);
    await createTransportLeg(f.ctx, { entityType: "sample", entityId: created.id, distanceKm: 10, loadMassKg: 1,
      transportMethodType: "road", calculationMethodType: "distance_based" });

    await runOperation(deleteLabSample, f.ctx, { labSampleId: created.id, expectedVersion: 1 }, { dryRun: true });
    expect(provider.deleteCalls).toEqual([]);
    expect(await sampleRows(f)).toHaveLength(1);
    expect(await legRows(f)).toHaveLength(1);

    await expect(runOperation(deleteLabSample, f.ctx, { labSampleId: created.id, expectedVersion: 2 })).rejects.toMatchObject({ code: "stale_version" });
    expect(provider.deleteCalls).toEqual([]);

    await runOperationInProcess(deleteLabSample, f.ctx, { labSampleId: created.id, expectedVersion: 1 });
    expect(await sampleRows(f)).toEqual([]);
    expect(await legRows(f)).toEqual([]);
    expect(await db.select().from(documents).where(and(eq(documents.organizationId, f.ctx.organizationId), eq(documents.entityId, created.id)))).toEqual([]);
    expect(provider.deleteCalls).toEqual([key]);
  });
});

describe("batch window edits (round 7 Q55)", { timeout: SUITE_TIMEOUT_MS }, () => {
  it("allows a batch edit that moves the window past a stored sample, and readiness then blocks on it", async () => {
    const f = await fixture({ withSecondBatch: false });
    const created = (await record(f, { samplingTime: "2026-09-05T08:00:00Z" })).data.sample;
    // R1 ran on 2026-09-09, so it stays inside the new window.
    await updateCreditBatch(f.ctx, f.batchA.id, { expectedVersion: await labLogisticsVersion(f.ctx, "creditBatches", f.batchA.id), startDate: new Date("2026-09-08") });
    const [batch] = await db.select().from(creditBatches).where(and(eq(creditBatches.id, f.batchA.id), eq(creditBatches.organizationId, f.ctx.organizationId)));
    expect(batch.startDate).toBe("2026-09-08");
    expect(await sampleRows(f)).toMatchObject([{ id: created.id, creditBatchId: f.batchA.id }]);

    const readiness = await loadDurabilityBatchData(f.ctx, [f.batchA.id], new Set([f.batchA.runId]));
    expect(readiness.blockers).toContain(
      `Sample ${created.sampleCode} was taken on 2026-09-05, before credit batch ${f.batchA.code}'s production window, 2026-09-08 to 2026-09-30. Correct the Sample date before submitting (§8.3.1).`,
    );
    // An edit to the flagged sample that leaves its time alone still saves.
    expect((await runOperation(updateLabSample, f.ctx, { labSampleId: created.id, expectedVersion: 1, labName: "Lab" })).data.sample.labName).toBe("Lab");
  });
});
