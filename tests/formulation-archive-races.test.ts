import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.hoisted(() => { process.env.DB_POOL_LOCK_TIMEOUT_MS = "5000"; });
import { and, eq } from "drizzle-orm";
import type { Pool } from "pg";
import { db } from "@/db";
import { formulations, orders } from "@/db/schema";
import { createStorageLocation, updateStorageLocation } from "@/data-access/storage-locations";
import { createStorageLocation as quickAdd } from "@/data-access/quick-add";
import { archiveFormulation, updateFormulation, deleteFormulation } from "@/lib/operations/formulations";
import { makeBiocharProduct } from "@/lib/operations/biochar-products";
import { recordOrder, updateOrder } from "@/lib/operations/orders";
import { runOperation } from "@/lib/operations/runner";
import { openOperationBarrier, waitForBlockedOperations } from "./helpers/operation-barrier";
import { createTestPool } from "./helpers/operation-fixture";
import { createOrderFixture, cleanupOrderFixture, orderInput, type OrderFixture } from "./helpers/order-operation-fixture";

const TIMEOUT_MS = 60_000;
const BARRIER_CONNECTIONS = 2;
const WRITER_CONNECTIONS = 2;
let barriers: Pool;
let writers: Pool;
const fixtures: OrderFixture[] = [];
beforeAll(() => { barriers = createTestPool(BARRIER_CONNECTIONS); writers = createTestPool(WRITER_CONNECTIONS); });
afterEach(async () => { for (const f of fixtures.splice(0)) await cleanupOrderFixture(f); });
afterAll(async () => { await barriers.end(); await writers.end(); });
async function fixture() { const f = await createOrderFixture(); fixtures.push(f); return f; }
function settle(work: Promise<unknown>) {
  return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
}

// Queue the first actual row-lock request before starting the second. The
// separate observer proves both operations wait on this barrier, transitively.
async function queue(f: OrderFixture, id: string, calls: (() => Promise<unknown>)[]) {
  const barrier = await openOperationBarrier(barriers);
  const pending: ReturnType<typeof settle>[] = [];
  try {
    await barrier.tx.select().from(formulations)
      .where(and(eq(formulations.organizationId, f.ctx.organizationId), eq(formulations.id, id))).for("update");
    for (const [index, call] of calls.entries()) {
      pending.push(settle(call()));
      await waitForBlockedOperations(barriers, barrier.pid, index + 1);
    }
    await barrier.commit();
  } catch (error) {
    await barrier.rollback();
    await Promise.allSettled(pending);
    throw error;
  }
  return Promise.all(pending);
}

describe("formulation archive serialization", { timeout: TIMEOUT_MS }, () => {
  for (const kind of ["product", "order", "order repoint", "bin create", "bin reassign", "quick-add"] as const) {
    it.each([true, false])(`${kind} versus archive, archive first: %s`, async archiveFirst => {
      const f = await fixture();
      const row = kind === "product" ? f.recipe : f.pure;
      const order = kind === "order repoint" ? (await runOperation(recordOrder, f.ctx, orderInput(f), { pool: writers })).data : undefined;
      const bin = { facilityId: f.facility.id, formulationId: row.id, code: "BIN-RACE", name: "Race product bin", type: "product_bin" as const };
      const write = () => {
        switch (kind) {
          case "product": return runOperation(makeBiocharProduct, f.ctx, {
            facilityId: f.facility.id, formulationId: row.id, placedAt: "2026-09-12T12:00:00Z",
            sourceBiocharStorageLocationId: f.source.id, storageLocationId: f.bin.id,
            biocharWetMassKg: 100, biocharMoisturePercent: 10, waterAddedKg: 0,
            ingredients: [{ formulationIngredientId: f.ingredient.id, storageLocationId: null, wetMassKg: 0 }],
          }, { pool: writers });
          case "order": return runOperation(recordOrder, f.ctx, { ...orderInput(f), formulationId: row.id }, { pool: writers });
          case "order repoint": return runOperation(updateOrder, f.ctx, { orderId: order!.id, expectedVersion: order!.version, formulationId: row.id }, { pool: writers });
          case "bin create": return createStorageLocation(f.ctx, bin);
          case "bin reassign": return updateStorageLocation(f.ctx, f.bin.id, { expectedVersion: f.bin.version, formulationId: row.id });
          case "quick-add": return quickAdd(f.ctx, bin);
        }
      };
      const archive = () => runOperation(archiveFormulation, f.ctx, { formulationId: row.id, expectedVersion: row.version }, { pool: writers });
      const results = await queue(f, row.id, archiveFirst ? [archive, write] : [write, archive]);
      expect(results[0].ok).toBe(true);
      if (archiveFirst) {
        expect(results[1]).toMatchObject({ ok: false, error: {
          code: "not_found", message: `Formulation ${row.code} is archived. Restore it or choose another formulation.`,
          issues: [expect.objectContaining({ path: ["formulationId"] })],
        } });
      } else {
        expect(results[1]).toMatchObject({ ok: true });
      }
      const [saved] = await db.select().from(formulations).where(eq(formulations.id, row.id));
      expect(saved).toMatchObject({ version: 2, archivedAt: expect.any(Date) });
    });
  }

  it.each([true, false])("echoed order PATCH versus archive both succeed, archive first: %s", async archiveFirst => {
    const f = await fixture();
    const order = (await runOperation(recordOrder, f.ctx, orderInput(f), { pool: writers })).data;
    const archive = () => runOperation(archiveFormulation, f.ctx, {
      formulationId: f.recipe.id, expectedVersion: f.recipe.version,
    }, { pool: writers });
    const update = () => runOperation(updateOrder, f.ctx, {
      orderId: order.id, expectedVersion: order.version, formulationId: order.formulationId, quantityKg: 200,
    }, { pool: writers });
    const results = await queue(f, f.recipe.id, archiveFirst ? [archive, update] : [update, archive]);
    expect(results).toMatchObject([{ ok: true }, { ok: true }]);
    const [savedOrder] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(savedOrder).toMatchObject({ formulationId: f.recipe.id, quantityKg: 200, version: 2 });
    const [savedFormulation] = await db.select().from(formulations).where(eq(formulations.id, f.recipe.id));
    expect(savedFormulation).toMatchObject({ version: 2, archivedAt: expect.any(Date) });
  });

  it.each([true, false])("delete versus archive, archive first: %s", async archiveFirst => {
    const f = await fixture();
    const input = { formulationId: f.pure.id, expectedVersion: f.pure.version };
    const archive = () => runOperation(archiveFormulation, f.ctx, input, { pool: writers });
    const remove = () => runOperation(deleteFormulation, f.ctx, input, { pool: writers });
    const results = await queue(f, f.pure.id, archiveFirst ? [archive, remove] : [remove, archive]);
    expect(results[0].ok).toBe(true);
    expect(results[1]).toMatchObject({ ok: false, error: { code: archiveFirst ? "stale_version" : "not_found" } });
    const rows = await db.select().from(formulations).where(eq(formulations.id, f.pure.id));
    expect(rows).toHaveLength(archiveFirst ? 1 : 0);
  });

  it.each([true, false])("PATCH versus archive, archive first: %s", async archiveFirst => {
    const f = await fixture();
    const input = { formulationId: f.pure.id, expectedVersion: f.pure.version };
    const archive = () => runOperation(archiveFormulation, f.ctx, input, { pool: writers });
    const update = () => runOperation(updateFormulation, f.ctx, { ...input, name: "Changed first" }, { pool: writers });
    const results = await queue(f, f.pure.id, archiveFirst ? [archive, update] : [update, archive]);
    expect(results[0].ok).toBe(true);
    expect(results[1]).toMatchObject({ ok: false, error: { code: archiveFirst ? "not_found" : "stale_version" } });
    const [saved] = await db.select().from(formulations).where(eq(formulations.id, f.pure.id));
    expect(saved).toMatchObject({ version: 2, archivedAt: archiveFirst ? expect.any(Date) : null });
  });
});
