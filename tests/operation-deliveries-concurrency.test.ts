import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Pool } from "pg";
import { db } from "@/db";
import { apiAuditEvents, apiIdempotencyRecords, binMovements, deliveries, outputStockAllocations } from "@/db/schema";
import { lockBiocharTransportRouteTopology } from "@/data-access/transport-legs";
import { getOutputStockHistory } from "@/data-access/output-stock-history";
import * as ownedTransaction from "@/data-access/owned-transaction";
import { recordDelivery, recordDeliveryForUi, updateDeliveryOperation, updatePostedDelivery } from "@/lib/operations/deliveries";
import { runOperation, runOperationInProcess } from "@/lib/operations/runner";
import { createTestPool } from "./helpers/operation-fixture";
import { openOperationBarrier, waitForBlockedOperations } from "./helpers/operation-barrier";
import { createDeliveryFixture } from "./helpers/delivery-create-fixture";
import { cleanupOutputStockFixture } from "./helpers/output-stock-cleanup";

const SUITE_TIMEOUT_MS = 60_000;
const BARRIER_POOL_SIZE = 2;
const WRITER_POOL_SIZE = 2;
const ORIGINAL_WET_KG = 40;
const CORRECTED_WET_KG = 20;
const ORIGINAL_DRY_KG = 28.8;
const CORRECTED_DRY_KG = 14.4;
let barrierPool: Pool;
let writerPool: Pool;
type Fixture = Awaited<ReturnType<typeof createDeliveryFixture>>;
const fixtures: Fixture[] = [];
beforeAll(() => { barrierPool = createTestPool(BARRIER_POOL_SIZE); writerPool = createTestPool(WRITER_POOL_SIZE); });
afterAll(async () => { await barrierPool.end(); await writerPool.end(); });
afterEach(async () => {
  vi.restoreAllMocks();
  for (const f of fixtures.splice(0)) {
    await db.delete(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.organizationId, f.ctx.organizationId));
    await db.delete(apiAuditEvents).where(eq(apiAuditEvents.organizationId, f.ctx.organizationId));
    await cleanupOutputStockFixture(db, f.ctx.organizationId);
  }
});
async function fixture() { const f = await createDeliveryFixture(); fixtures.push(f); return f; }
function input(f: Fixture) { const facts: Partial<typeof f.input> = { ...f.input }; delete facts.idempotencyKey; return { ...facts, deliveredWetMassKg: ORIGINAL_WET_KG }; }
const rows = (f: Fixture) => db.select().from(deliveries).where(eq(deliveries.organizationId, f.ctx.organizationId));
const movements = (f: Fixture) => db.select().from(binMovements).where(and(eq(binMovements.organizationId, f.ctx.organizationId), eq(binMovements.outputKind, "delivery")));
const audit = (f: Fixture) => ({ credentialId: `delivery-${f.tag}`, requestId: randomUUID(), transport: "rest" as const });
function settle<T>(work: Promise<T>) { return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })); }

/** Hold topology on a third connection and release writers in their observed queue order. */
async function queue(f: Fixture, writers: (() => Promise<unknown>)[]) {
  const barrier = await openOperationBarrier(barrierPool);
  const started: ReturnType<typeof settle>[] = [];
  try {
    await lockBiocharTransportRouteTopology(f.ctx, barrier.tx);
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

describe("delivery operation races", { timeout: SUITE_TIMEOUT_MS }, () => {
  it("parallel duplicate runner keys write one delivery, one movement and one audit event", async () => {
    // A second module instance represents another worker with its own in-flight set.
    vi.resetModules();
    const otherRunner = await import("@/lib/operations/runner");
    const f = await fixture();
    const options = { pool: writerPool, audit: audit(f), idempotency: { credentialId: `delivery-${f.tag}`, key: randomUUID() } };
    const barrier = await openOperationBarrier(barrierPool);
    let first: ReturnType<typeof settle> | undefined;
    let second: ReturnType<typeof settle> | undefined;
    try {
      await lockBiocharTransportRouteTopology(f.ctx, barrier.tx);
      first = settle(runOperation(recordDelivery, f.ctx, input(f), options));
      await waitForBlockedOperations(barrierPool, barrier.pid, 1);
      second = settle(otherRunner.runOperation(recordDelivery, f.ctx, input(f), options));
      await waitForBlockedOperations(barrierPool, barrier.pid, 2);
      expect(await second).toMatchObject({ ok: false, error: { code: "idempotency_in_progress" } });
      // Same-worker duplicates are refused before waiting for another connection too.
      await expect(runOperation(recordDelivery, f.ctx, input(f), options)).rejects.toMatchObject({ code: "idempotency_in_progress" });
      await barrier.commit();
    } catch (error) {
      await barrier.rollback();
      await Promise.allSettled([first, second]);
      throw error;
    }
    expect((await first!).ok).toBe(true);
    expect((await runOperation(recordDelivery, f.ctx, input(f), options)).replayed).toBe(true);
    expect(await rows(f)).toHaveLength(1);
    expect(await movements(f)).toHaveLength(1);
    expect(await db.select().from(apiAuditEvents).where(eq(apiAuditEvents.organizationId, f.ctx.organizationId))).toHaveLength(1);
    expect(await db.select().from(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.organizationId, f.ctx.organizationId))).toHaveLength(1);
  });

  it.each([true, false])("UI stock correction versus metadata PATCH refuses the stale writer, correction first: %s", async correctionFirst => {
    const f = await fixture();
    const created = (await runOperation(recordDelivery, f.ctx, input(f), { pool: writerPool })).data.delivery;
    const target = { deliveryId: created.id, expectedVersion: created.version };
    const correct = () => runOperationInProcess(updatePostedDelivery, f.ctx, { ...target, deliveredWetMassKg: CORRECTED_WET_KG }, { pool: writerPool });
    const patch = () => runOperation(updateDeliveryOperation, f.ctx, { ...target, distanceNote: "PATCH note" }, { pool: writerPool });
    const [first, second] = await queue(f, correctionFirst ? [correct, patch] : [patch, correct]);
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, error: { code: "stale_version" } });
    expect(await rows(f)).toMatchObject([{ id: created.id, version: created.version + (correctionFirst ? 2 : 1),
      deliveredWetMassKg: correctionFirst ? CORRECTED_WET_KG : ORIGINAL_WET_KG,
      massDryKg: correctionFirst ? CORRECTED_DRY_KG : ORIGINAL_DRY_KG,
      distanceNote: correctionFirst ? null : "PATCH note" }]);
    const history = (await getOutputStockHistory(f.ctx, f.bin.id)).filter(entry => entry.deliveryId === created.id);
    expect(history.filter(entry => entry.kind === "replacement")).toHaveLength(correctionFirst ? 1 : 0);
    expect(history.filter(entry => entry.kind === "reversal")).toHaveLength(correctionFirst ? 1 : 0);
  });

  it.each(["40P01", "55P03"])("retries registered delivery create after %s aborts a fully written first attempt", async code => {
    const f = await fixture();
    const original = ownedTransaction.runOwnedTransaction;
    const attempts = vi.spyOn(ownedTransaction, "runOwnedTransaction").mockImplementationOnce((ctx, deadline, callback, pool) =>
      original(ctx, deadline, async tx => { await callback(tx); throw Object.assign(new Error("Forced retry"), { code }); }, pool));
    const options = { pool: writerPool, audit: audit(f), idempotency: { credentialId: `delivery-${f.tag}`, key: randomUUID() } };
    const saved = await runOperation(recordDelivery, f.ctx, input(f), options);
    expect(attempts).toHaveBeenCalledTimes(2);
    expect(await rows(f)).toMatchObject([{ id: saved.data.delivery.id, deliveredWetMassKg: ORIGINAL_WET_KG }]);
    expect(await rows(f)).toHaveLength(1);
    const [movement] = await movements(f);
    expect(await movements(f)).toHaveLength(1);
    expect(await db.select().from(outputStockAllocations).where(eq(outputStockAllocations.deliveryId, saved.data.delivery.id)))
      .toMatchObject([{ movementId: movement.id }]);
    expect(await db.select().from(apiAuditEvents).where(eq(apiAuditEvents.organizationId, f.ctx.organizationId))).toHaveLength(1);
    expect((await runOperation(recordDelivery, f.ctx, input(f), options)).data).toEqual(saved.data);
  });

  it("retries the UI create after a deadlock and preserves its stock key and custom code", async () => {
    const f = await fixture();
    const original = ownedTransaction.runOwnedTransaction;
    const attempts = vi.spyOn(ownedTransaction, "runOwnedTransaction").mockImplementationOnce((ctx, deadline, callback, pool) =>
      original(ctx, deadline, async tx => { await callback(tx); throw Object.assign(new Error("Forced deadlock"), { code: "40P01" }); }, pool));
    const saved = await runOperationInProcess(recordDeliveryForUi, f.ctx,
      { ...input(f), idempotencyKey: f.input.idempotencyKey, code: "DL-RETRY" }, { pool: writerPool });
    expect(attempts).toHaveBeenCalledTimes(2);
    expect(saved.delivery.code).toBe("DL-RETRY");
    expect(await rows(f)).toHaveLength(1);
    expect((await movements(f)).map(row => row.idempotencyKey)).toEqual([f.input.idempotencyKey]);
  });
});
