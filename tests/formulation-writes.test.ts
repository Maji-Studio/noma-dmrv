import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.hoisted(() => { process.env.DB_POOL_MAX = "1"; });
import { and, eq } from "drizzle-orm";
import type { Pool } from "pg";
import { db } from "@/db";
import { activityEvents, feedstockTypes, formulationIngredients, formulations, orders } from "@/db/schema";
import { createFormulation, updateFormulation, deleteFormulation } from "@/lib/operations/formulations";
import { makeBiocharProduct } from "@/lib/operations/biochar-products";
import { recordOrder } from "@/lib/operations/orders";
import { runOperation, runOperationInProcess } from "@/lib/operations/runner";
import { updateFeedstockType } from "@/data-access/feedstock-types";
import { generateNextCodes } from "@/data-access/code-generator";
import { createOrderFixture, cleanupOrderFixture, orderInput, type OrderFixture } from "./helpers/order-operation-fixture";
import { createTestPool } from "./helpers/operation-fixture";
import { openOperationBarrier, waitForBlockedOperations } from "./helpers/operation-barrier";
import { postedStockFixture, cleanupPostedStock } from "./helpers/posted-output-stock-fixture";

const TIMEOUT_MS = 60_000;
const SINGLE_CONNECTION = 1;
const BARRIER_CONNECTIONS = 2;
let pool: Pool;
let barriers: Pool;
const fixtures: OrderFixture[] = [];
const stockFixtures: Awaited<ReturnType<typeof postedStockFixture>>[] = [];
beforeAll(() => { pool = db.$client; expect(pool.options.max).toBe(SINGLE_CONNECTION); barriers = createTestPool(BARRIER_CONNECTIONS); });
afterEach(async () => {
  for (const f of stockFixtures.splice(0)) await cleanupPostedStock(f);
  for (const f of fixtures.splice(0)) await cleanupOrderFixture(f);
});
afterAll(async () => { await barriers.end(); });
async function fixture() { const f = await createOrderFixture(); fixtures.push(f); return f; }
async function material(f: OrderFixture, overrides: Partial<typeof feedstockTypes.$inferInsert> = {}) {
  const tag = crypto.randomUUID();
  const [row] = await db.insert(feedstockTypes).values({ organizationId: f.ctx.organizationId, code: `FT-${tag}`, name: `Blend ${tag}`, category: "compost", usage: "blend", ...overrides }).returning();
  return row;
}
const issue = (code: string, path: (string | number)[]) => ({ code, issues: [expect.objectContaining({ path })] });

describe("formulation runner writes", { timeout: TIMEOUT_MS }, () => {
  it("keeps recipe order, exact millionths and stable line ids; adds and removes unused lines", async () => {
    const f = await fixture(); const a = await material(f); const b = await material(f); const c = await material(f);
    const created = await runOperationInProcess(createFormulation, f.ctx, { name: " Three shares ", biocharRatio: 0.333333, lines: [{ feedstockTypeId: b.id, ratio: 0.333333 }, { feedstockTypeId: a.id, ratio: 0.333334 }] }, { pool });
    expect(created.name).toBe("Three shares");
    expect(created.ingredients.map(line => [line.feedstockTypeId, line.ratio])).toEqual([[b.id, 0.333333], [a.id, 0.333334]]);
    const changed = await runOperationInProcess(updateFormulation, f.ctx, { formulationId: created.id, expectedVersion: 1, biocharRatio: 0.7, lines: [{ feedstockTypeId: a.id, ratio: 0.2 }, { feedstockTypeId: b.id, ratio: 0.1 }] }, { pool });
    expect(changed.ingredients.map(line => line.id)).toEqual([...created.ingredients].reverse().map(line => line.id));
    const added = await runOperationInProcess(updateFormulation, f.ctx, { formulationId: created.id, expectedVersion: 2, lines: [{ feedstockTypeId: a.id, ratio: 0.1 }, { feedstockTypeId: c.id, ratio: 0.1 }] }, { pool });
    expect(added.ingredients[0].id).toBe(changed.ingredients[0].id);
    expect(added.ingredients[1].id).not.toBe(changed.ingredients[1].id);
    expect(await db.select().from(formulationIngredients).where(eq(formulationIngredients.id, created.ingredients[0].id))).toEqual([]);
    await runOperation(deleteFormulation, f.ctx, { formulationId: created.id, expectedVersion: 3 }, { pool });
    expect(await db.select().from(formulationIngredients).where(eq(formulationIngredients.formulationId, created.id))).toEqual([]);
    const events = await db.select().from(activityEvents).where(and(eq(activityEvents.organizationId, f.ctx.organizationId), eq(activityEvents.entityId, created.id)));
    expect(events).toHaveLength(4);
    expect(events.map(event => event.entityType)).toEqual(Array(4).fill("formulation"));
  });

  it.each(["biocharRatio", "lines"] as const)("records only %s for a ratio-only PATCH", async field => {
    const f = await fixture();
    const patch = field === "biocharRatio" ? { biocharRatio: 0.7 }
      : { lines: [{ feedstockTypeId: f.ingredientType.id, ratio: 0.1 }] };
    await runOperation(updateFormulation, f.ctx, { formulationId: f.recipe.id, expectedVersion: 1, ...patch }, { pool });
    const events = await db.select().from(activityEvents).where(and(
      eq(activityEvents.organizationId, f.ctx.organizationId), eq(activityEvents.entityId, f.recipe.id),
    ));
    expect(events).toHaveLength(1);
    expect(events[0].changedFields).toEqual([field]);
  });

  it("refuses excess precision, duplicates and one millionth too much, including merged PATCH", async () => {
    const f = await fixture(); const a = await material(f);
    await expect(runOperation(createFormulation, f.ctx, { name: "Precision", lines: [{ feedstockTypeId: a.id, ratio: 0.3333333 }] }, { pool })).rejects.toMatchObject({ code: "validation_failed", issues: expect.arrayContaining([expect.objectContaining({ path: ["lines", 0, "ratio"] })]) });
    await expect(runOperation(createFormulation, f.ctx, { name: "Duplicate", lines: [{ feedstockTypeId: a.id }, { feedstockTypeId: a.id }] }, { pool })).rejects.toMatchObject(issue("validation_failed", ["lines", 1, "feedstockTypeId"]));
    await expect(runOperation(createFormulation, f.ctx, { name: "Excess", biocharRatio: 0.700001, lines: [{ feedstockTypeId: a.id, ratio: 0.3 }] }, { pool })).rejects.toMatchObject(issue("validation_failed", ["biocharRatio"]));
    const row = (await runOperation(createFormulation, f.ctx, { name: "Exact", biocharRatio: 0.7, description: "Keep", lines: [{ feedstockTypeId: a.id, ratio: 0.3 }] }, { pool })).data;
    await expect(runOperation(updateFormulation, f.ctx, { formulationId: row.id, expectedVersion: 1, biocharRatio: 0.700001 }, { pool })).rejects.toMatchObject(issue("validation_failed", ["biocharRatio"]));
    await expect(runOperation(updateFormulation, f.ctx, { formulationId: row.id, expectedVersion: 1, lines: [{ feedstockTypeId: a.id, ratio: 0.300001 }] }, { pool })).rejects.toMatchObject(issue("validation_failed", ["biocharRatio"]));
    const kept = (await runOperation(updateFormulation, f.ctx, { formulationId: row.id, expectedVersion: 1, name: "Renamed" }, { pool })).data;
    expect(kept).toMatchObject({ biocharRatio: 0.7, description: "Keep", version: 2 });
    const cleared = (await runOperation(updateFormulation, f.ctx, { formulationId: row.id, expectedVersion: 2, biocharRatio: null, description: null }, { pool })).data;
    expect(cleared).toMatchObject({ biocharRatio: null, description: null });
    await expect(runOperation(deleteFormulation, f.ctx, { formulationId: row.id, expectedVersion: 1 }, { pool })).rejects.toMatchObject({ code: "stale_version" });
  });

  it("refuses unknown, foreign, archived and non-blend types but retains later-archived lines", async () => {
    const f = await fixture(); const foreign = await fixture();
    const a = await material(f); const other = await material(foreign);
    const archived = await material(f, { archivedAt: new Date() });
    const nonBlend = await material(f, { usage: "pyrolysis", category: "forestry" });
    for (const id of [crypto.randomUUID(), other.id, archived.id]) {
      await expect(runOperation(createFormulation, f.ctx, { name: "Missing", lines: [{ feedstockTypeId: id }] }, { pool })).rejects.toMatchObject(issue("not_found", ["lines", 0, "feedstockTypeId"]));
    }
    await expect(runOperation(createFormulation, f.ctx, { name: "Wrong use", lines: [{ feedstockTypeId: nonBlend.id }] }, { pool })).rejects.toMatchObject(issue("validation_failed", ["lines", 0, "feedstockTypeId"]));
    const row = (await runOperation(createFormulation, f.ctx, { name: "Retained", lines: [{ feedstockTypeId: a.id }] }, { pool })).data;
    await db.update(feedstockTypes).set({ archivedAt: new Date() }).where(eq(feedstockTypes.id, a.id));
    await expect(runOperation(updateFormulation, f.ctx, { formulationId: row.id, expectedVersion: 1, lines: [{ feedstockTypeId: a.id, ratio: 0.2 }] }, { pool })).resolves.toMatchObject({ data: { version: 2 } });
    for (const id of [crypto.randomUUID(), foreign.recipe.id]) {
      await expect(runOperation(updateFormulation, f.ctx, { formulationId: id, expectedVersion: 1, name: "No" }, { pool })).rejects.toMatchObject(issue("not_found", ["formulationId"]));
      await expect(runOperation(deleteFormulation, f.ctx, { formulationId: id, expectedVersion: 1 }, { pool })).rejects.toMatchObject(issue("not_found", ["formulationId"]));
    }
    await db.update(formulations).set({ archivedAt: new Date() }).where(eq(formulations.id, row.id));
    await expect(updateFeedstockType(f.ctx, { feedstockTypeId: a.id, expectedVersion: a.version, usage: "pyrolysis", category: "forestry" })).rejects.toMatchObject(issue("conflict", ["usage"]));
  });

  it("changes codes and returns typed duplicate code conflicts", async () => {
    const f = await fixture();
    const a = (await runOperation(createFormulation, f.ctx, { name: "A" }, { pool })).data;
    const b = (await runOperation(createFormulation, f.ctx, { name: "B" }, { pool })).data;
    await expect(runOperation(updateFormulation, f.ctx, { formulationId: a.id, expectedVersion: 1, code: "BCF-EDIT" }, { pool })).resolves.toMatchObject({ data: { code: "BCF-EDIT", version: 2 } });
    await expect(runOperation(updateFormulation, f.ctx, { formulationId: b.id, expectedVersion: 1, code: "BCF-EDIT" }, { pool })).rejects.toMatchObject(issue("conflict", ["code"]));
  });

  it("rolls back create, update and delete dry runs with all lines and Activity", async () => {
    const f = await fixture(); const a = await material(f);
    const input = { name: "Dry", lines: [{ feedstockTypeId: a.id, ratio: 0.333333 }] };
    const dry = (await runOperation(createFormulation, f.ctx, input, { pool, dryRun: true })).data;
    expect(await db.select().from(formulations).where(eq(formulations.id, dry.id))).toEqual([]);
    expect(await db.select().from(formulationIngredients).where(eq(formulationIngredients.formulationId, dry.id))).toEqual([]);
    const row = (await runOperation(createFormulation, f.ctx, input, { pool })).data;
    await runOperation(updateFormulation, f.ctx, { formulationId: row.id, expectedVersion: 1, lines: [] }, { pool, dryRun: true });
    await runOperation(deleteFormulation, f.ctx, { formulationId: row.id, expectedVersion: 1 }, { pool, dryRun: true });
    expect(await db.select().from(formulations).where(eq(formulations.id, row.id))).toMatchObject([{ version: 1 }]);
    expect(await db.select().from(formulationIngredients).where(eq(formulationIngredients.formulationId, row.id))).toHaveLength(1);
    expect(await db.select().from(activityEvents).where(eq(activityEvents.organizationId, f.ctx.organizationId))).toHaveLength(1);
  });

  it.each([false, true])("refuses order references, archived: %s", async archived => {
    const f = await fixture();
    const row = (await runOperation(createFormulation, f.ctx, { name: "Ordered" }, { pool })).data;
    const order = (await runOperation(recordOrder, f.ctx, { ...orderInput(f), formulationId: row.id }, { pool })).data;
    if (archived) await db.update(orders).set({ archivedAt: new Date() }).where(eq(orders.id, order.id));
    await expect(runOperation(deleteFormulation, f.ctx, { formulationId: row.id, expectedVersion: 1 }, { pool })).rejects.toMatchObject({ ...issue("conflict", ["formulationId"]), issues: [expect.objectContaining({ meta: { orderCodes: [order.code] } })] });
  });

  it("refuses bin and product references and snapshot-line removal with blocker metadata", async () => {
    const f = await fixture();
    await expect(runOperation(deleteFormulation, f.ctx, { formulationId: f.recipe.id, expectedVersion: 1 }, { pool })).rejects.toMatchObject({ code: "conflict", message: "Formulation was not deleted because product bins use it. Keep this formulation.",
      issues: [expect.objectContaining({ path: ["formulationId"], meta: { binCodes: [f.bin.code] } })],
    });
    const stock = await postedStockFixture(); stockFixtures.push(stock);
    await expect(runOperation(deleteFormulation, stock.ctx, { formulationId: stock.pure.id, expectedVersion: stock.pure.version }, { pool })).rejects.toMatchObject({ code: "conflict", message: "Formulation was not deleted because biochar products use it. Keep this formulation." });
    const productCodes: string[] = [];
    for (let index = 0; index < 6; index++) {
      const made = await runOperation(makeBiocharProduct, f.ctx, {
        facilityId: f.facility.id, formulationId: f.recipe.id, placedAt: "2026-09-12T12:00:00.000Z",
        sourceBiocharStorageLocationId: f.source.id, storageLocationId: f.bin.id,
        biocharWetMassKg: 100, biocharMoisturePercent: 10, waterAddedKg: 0,
        ingredients: [{ formulationIngredientId: f.ingredient.id, storageLocationId: null, wetMassKg: 1, moisturePercent: 0 }],
      }, { pool });
      productCodes.push(made.data.product.code);
    }
    await expect(runOperation(updateFormulation, f.ctx, { formulationId: f.recipe.id, expectedVersion: 1, lines: [] }, { pool })).rejects.toMatchObject({ code: "conflict", issues: [expect.objectContaining({ path: ["lines"], meta: { formulationIngredientId: f.ingredient.id, feedstockTypeId: f.ingredientType.id, productCodes: productCodes.sort().slice(0, 5) } })] });

  });

  it("replays a create after deletion without another Activity event", async () => {
    const f = await fixture();
    const input = { name: "Replay" };
    const idempotency = { credentialId: "formulation-test", key: crypto.randomUUID() };
    const first = await runOperation(createFormulation, f.ctx, input, { pool, idempotency });
    await runOperation(deleteFormulation, f.ctx, { formulationId: first.data.id, expectedVersion: 1 }, { pool });
    const replay = await runOperation(createFormulation, f.ctx, input, { pool, idempotency });
    expect(replay).toMatchObject({ replayed: true, data: first.data });
    expect(await db.select().from(activityEvents).where(eq(activityEvents.entityId, first.data.id))).toHaveLength(2);
    expect(await db.select().from(formulations).where(eq(formulations.id, first.data.id))).toEqual([]);
  });

  it("recovers a forced generated-code collision inside a savepoint", async () => {
    const f = await fixture();
    const [taken] = await generateNextCodes(f.ctx, "BCF", formulations, formulations.code, 1);
    const barrier = await openOperationBarrier(barriers);
    let pending: ReturnType<typeof runOperationInProcess<typeof createFormulation.input, Awaited<ReturnType<typeof createFormulation.execute>>>> | undefined;
    try {
      await barrier.tx.insert(formulations).values({ organizationId: f.ctx.organizationId, code: taken, name: "Race winner" });
      pending = runOperationInProcess(createFormulation, f.ctx, { name: "Retry" }, { pool });
      await waitForBlockedOperations(barriers, barrier.pid, 1);
      await barrier.commit();
    } catch (error) { await barrier.rollback(); await Promise.allSettled([pending]); throw error; }
    expect((await pending!).code).not.toBe(taken);
  });
});
