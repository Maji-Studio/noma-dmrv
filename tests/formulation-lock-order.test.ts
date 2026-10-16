import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.hoisted(() => { process.env.DB_POOL_LOCK_TIMEOUT_MS = "5000"; });
import { and, eq } from "drizzle-orm";
import type { Pool } from "pg";
import { db } from "@/db";
import { biocharProducts, feedstockTypes, formulationIngredients, formulations, storageLocations } from "@/db/schema";
import { createStorageLocation, updateStorageLocation } from "@/data-access/storage-locations";
import { createStorageLocation as quickAdd } from "@/data-access/quick-add";
import { updateFeedstockType } from "@/data-access/feedstock-types";
import { createFormulation, updateFormulation, deleteFormulation } from "@/lib/operations/formulations";
import { makeBiocharProduct } from "@/lib/operations/biochar-products";
import { recordOrder } from "@/lib/operations/orders";
import { runOperation } from "@/lib/operations/runner";
import { openOperationBarrier, waitForBlockedOperations } from "./helpers/operation-barrier";
import { createTestPool } from "./helpers/operation-fixture";
import { createOrderFixture, cleanupOrderFixture, orderInput, type OrderFixture } from "./helpers/order-operation-fixture";

const TIMEOUT_MS = 60_000;
const CONNECTIONS = 2;
let barriers: Pool;
let writers: Pool;
const fixtures: OrderFixture[] = [];
beforeAll(() => { barriers = createTestPool(CONNECTIONS); writers = createTestPool(CONNECTIONS); });
afterEach(async () => { for (const f of fixtures.splice(0)) await cleanupOrderFixture(f); });
afterAll(async () => { await barriers.end(); await writers.end(); });
async function fixture() { const f = await createOrderFixture(); fixtures.push(f); return f; }
function settle(work: Promise<unknown>) { return work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error })); }
async function queue(f: OrderFixture, id: string, calls: (() => Promise<unknown>)[], type = false) {
  const barrier = await openOperationBarrier(barriers);
  const pending: ReturnType<typeof settle>[] = [];
  try {
    if (type) await barrier.tx.select().from(feedstockTypes).where(and(eq(feedstockTypes.organizationId, f.ctx.organizationId), eq(feedstockTypes.id, id))).for("update");
    else await barrier.tx.select().from(formulations).where(and(eq(formulations.organizationId, f.ctx.organizationId), eq(formulations.id, id))).for("update");
    for (const [index, call] of calls.entries()) {
      pending.push(settle(call()));
      await waitForBlockedOperations(barriers, barrier.pid, index + 1);
    }
    await barrier.commit();
  } catch (error) { await barrier.rollback(); await Promise.allSettled(pending); throw error; }
  return Promise.all(pending);
}

describe("formulation lock order", { timeout: TIMEOUT_MS }, () => {
  for (const kind of ["create", "update", "quick-add"] as const) {
    it.each([true, false])(`${kind} bin claim versus delete, claim first: %s`, async claimFirst => {
      const f = await fixture();
      const row = (await runOperation(createFormulation, f.ctx, { name: "Claim target" })).data;
      const data = { code: `BIN-${crypto.randomUUID()}`, name: `Claim ${crypto.randomUUID()}`, type: "product_bin" as const, facilityId: f.facility.id, formulationId: row.id };
      const claim = kind === "create" ? () => createStorageLocation(f.ctx, data)
        : kind === "quick-add" ? () => quickAdd(f.ctx, data)
        : () => updateStorageLocation(f.ctx, f.bin.id, { expectedVersion: f.bin.version, formulationId: row.id });
      const remove = () => runOperation(deleteFormulation, f.ctx, { formulationId: row.id, expectedVersion: 1 }, { pool: writers });
      const results = await queue(f, row.id, claimFirst ? [claim, remove] : [remove, claim]);
      expect(results[0].ok).toBe(true);
      expect(results[1]).toMatchObject({ ok: false, error: { code: claimFirst ? "conflict" : "not_found", issues: [expect.objectContaining({ path: ["formulationId"] })] } });
      const bins = await db.select().from(storageLocations).where(eq(storageLocations.formulationId, row.id));
      const parents = await db.select().from(formulations).where(eq(formulations.id, row.id));
      expect(bins).toHaveLength(claimFirst ? 1 : 0);
      expect(parents).toHaveLength(claimFirst ? 1 : 0);
    });
  }

  it.each([true, false])("order create versus delete, order first: %s", async orderFirst => {
    const f = await fixture();
    const row = (await runOperation(createFormulation, f.ctx, { name: "Order target" })).data;
    const create = () => runOperation(recordOrder, f.ctx, { ...orderInput(f), formulationId: row.id }, { pool: writers });
    const remove = () => runOperation(deleteFormulation, f.ctx, { formulationId: row.id, expectedVersion: 1 }, { pool: writers });
    const results = await queue(f, row.id, orderFirst ? [create, remove] : [remove, create]);
    expect(results[0].ok).toBe(true);
    expect(results[1]).toMatchObject({ ok: false, error: { code: orderFirst ? "conflict" : "not_found" } });
  });

  it.each([true, false])("product snapshots one locked recipe, product first: %s", async productFirst => {
    const f = await fixture();
    const [type] = await db.insert(feedstockTypes).values({ organizationId: f.ctx.organizationId, code: "FT-SECOND", name: "Second blend", category: "compost", usage: "blend" }).returning();
    const [line] = await db.insert(formulationIngredients).values({ organizationId: f.ctx.organizationId, formulationId: f.recipe.id, feedstockTypeId: type.id, ratio: 0, sortOrder: 1 }).returning();
    const create = () => runOperation(makeBiocharProduct, f.ctx, {
      facilityId: f.facility.id, formulationId: f.recipe.id, placedAt: "2026-09-12T12:00:00.000Z", sourceBiocharStorageLocationId: f.source.id,
      storageLocationId: f.bin.id, biocharWetMassKg: 100, biocharMoisturePercent: 10, waterAddedKg: 0,
      ingredients: [f.ingredient, line].map(row => ({ formulationIngredientId: row.id, storageLocationId: null, wetMassKg: 0 })),
    }, { pool: writers });
    const update = () => runOperation(updateFormulation, f.ctx, { formulationId: f.recipe.id, expectedVersion: 1, biocharRatio: 0.6,
      lines: [{ feedstockTypeId: f.ingredientType.id, ratio: 0.3 }, { feedstockTypeId: type.id, ratio: 0.1 }] }, { pool: writers });
    const results = await queue(f, f.recipe.id, productFirst ? [create, update] : [update, create]);
    expect(results.map(row => row.ok)).toEqual([true, true]);
    const [product] = await db.select().from(biocharProducts).where(eq(biocharProducts.organizationId, f.ctx.organizationId));
    expect(product.biocharRatio).toBe(productFirst ? 0.8 : 0.6);
    const composition = product.composition as { ingredients: { ratio: number }[] };
    expect(composition.ingredients.map(line => line.ratio)).toEqual(productFirst ? [0.2, 0] : [0.3, 0.1]);
  });

  it.each([true, false])("formulation create versus type usage change, formulation first: %s", async formulationFirst => {
    const f = await fixture();
    const [type] = await db.insert(feedstockTypes).values({
      organizationId: f.ctx.organizationId, code: "FT-CREATE", name: "Create blend", category: "compost", usage: "blend",
    }).returning();
    const create = () => runOperation(createFormulation, f.ctx, {
      name: "Concurrent create", lines: [{ feedstockTypeId: type.id, ratio: 0.1 }],
    }, { pool: writers });
    const usage = () => updateFeedstockType(f.ctx, {
      feedstockTypeId: type.id, expectedVersion: 1, usage: "pyrolysis", category: "forestry",
    });
    const results = await queue(f, type.id, formulationFirst ? [create, usage] : [usage, create], true);
    expect(results[0].ok).toBe(true);
    expect(results[1]).toMatchObject({ ok: false, error: {
      code: formulationFirst ? "conflict" : "validation_failed",
      issues: [expect.objectContaining({ path: formulationFirst ? ["usage"] : ["lines", 0, "feedstockTypeId"] })],
    } });
    const lines = await db.select().from(formulationIngredients).where(eq(formulationIngredients.feedstockTypeId, type.id));
    expect(lines).toHaveLength(formulationFirst ? 1 : 0);
    const [stored] = await db.select().from(feedstockTypes).where(eq(feedstockTypes.id, type.id));
    expect(stored.usage).toBe(formulationFirst ? "blend" : "pyrolysis");
  });

  it.each([true, false])("line addition versus type usage change, formulation first: %s", async formulationFirst => {
    const f = await fixture();
    const [type] = await db.insert(feedstockTypes).values({ organizationId: f.ctx.organizationId, code: "FT-NEW", name: "New blend", category: "compost", usage: "blend" }).returning();
    const row = (await runOperation(createFormulation, f.ctx, { name: "Usage target" })).data;
    const add = () => runOperation(updateFormulation, f.ctx, { formulationId: row.id, expectedVersion: 1, lines: [{ feedstockTypeId: type.id, ratio: 0.1 }] }, { pool: writers });
    const usage = () => updateFeedstockType(f.ctx, { feedstockTypeId: type.id, expectedVersion: 1, usage: "pyrolysis", category: "forestry" });
    const results = await queue(f, type.id, formulationFirst ? [add, usage] : [usage, add], true);
    expect(results[0].ok).toBe(true);
    expect(results[1]).toMatchObject({ ok: false, error: { code: formulationFirst ? "conflict" : "validation_failed", issues: [expect.objectContaining({ path: formulationFirst ? ["usage"] : ["lines", 0, "feedstockTypeId"] })] } });
  });
});
