import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.hoisted(() => { process.env.DB_POOL_MAX = "1"; });
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, apiIdempotencyRecords, feedstockTypes, formulations } from "@/db/schema";
import { operationRegistry } from "@/lib/operations/registry";
import { runOperation, runOperationInProcess } from "@/lib/operations/runner";
import { formulationRepresentationSchema } from "@/lib/representations/formulations";
import { readApiFormulation, readApiFormulationList } from "@/lib/read-models/api-formulations";
import { createOrderFixture, cleanupOrderFixture, type OrderFixture } from "./helpers/order-operation-fixture";
import { openOperationBarrier, waitForBlockedOperations } from "./helpers/operation-barrier";
import { createTestPool } from "./helpers/operation-fixture";

const TIMEOUT_MS = 30_000;
const SINGLE_CONNECTION = 1;
const CONCURRENT_CONNECTIONS = 2;
const fixtures: OrderFixture[] = [];
const pool = createTestPool(CONCURRENT_CONNECTIONS);
const barrierPool = createTestPool(CONCURRENT_CONNECTIONS);
const create = operationRegistry.create_formulation;
const update = operationRegistry.update_formulation;
const archive = operationRegistry.archive_formulation;
const restore = operationRegistry.restore_formulation;
const remove = operationRegistry.delete_formulation;
beforeAll(() => { expect(db.$client.options.max).toBe(SINGLE_CONNECTION); });
afterEach(async () => { for (const f of fixtures.splice(0)) await cleanupOrderFixture(f); });
afterAll(async () => { await pool.end(); await barrierPool.end(); });
async function fixture() { const f = await createOrderFixture(); fixtures.push(f); return f; }
const input = { name: "Operation recipe", biocharRatio: 1, description: "Recipe guidance", lines: [] };
const keyOptions = () => ({ idempotency: { credentialId: "formulation-test", key: crypto.randomUUID() } });
function representation(value: unknown) {
  const parsed = formulationRepresentationSchema.parse(value);
  expect(parsed).toEqual(value);
  expect(JSON.parse(JSON.stringify(value))).toEqual(value);
  return parsed;
}
function stable(value: unknown) {
  const row = representation(value);
  return { ...row, id: undefined, createdAt: undefined, updatedAt: undefined, archivedAt: row.archivedAt !== null };
}

describe("registered formulation operations", { timeout: TIMEOUT_MS }, () => {
  it.each(["json", "in-process"] as const)("returns revision 2 envelopes through %s and void for delete", async (mode) => {
    const f = await fixture();
    const made = mode === "json" ? (await runOperation(create, f.ctx, input)).data : await runOperationInProcess(create, f.ctx, input);
    expect(Object.keys(made)).toEqual(["formulation"]);
    const first = representation(made.formulation);
    expect(first).toMatchObject({ description: input.description, archivedAt: null, version: 1 });
    const changed = mode === "json"
      ? (await runOperation(update, f.ctx, { formulationId: first.id, expectedVersion: 1, description: "Changed" })).data
      : await runOperationInProcess(update, f.ctx, { formulationId: first.id, expectedVersion: 1, description: "Changed" });
    expect(representation(changed.formulation)).toMatchObject({ description: "Changed", version: 2 });
    for (const [operation, expectedVersion, archived] of [[archive, 2, true], [restore, 3, false]] as const) {
      const body = { formulationId: first.id, expectedVersion };
      const result = mode === "json" ? (await runOperation(operation, f.ctx, body)).data : await runOperationInProcess(operation, f.ctx, body);
      expect(representation(result.formulation).archivedAt !== null).toBe(archived);
    }
    const body = { formulationId: first.id, expectedVersion: 4 };
    if (mode === "json") expect((await runOperation(remove, f.ctx, body)).data).toBeNull();
    else expect(await runOperationInProcess(remove, f.ctx, body)).toBeUndefined();
    await expect(readApiFormulation(f.ctx, { id: first.id })).rejects.toMatchObject({ code: "not_found" });
  });

  it("records persisted ratio changes and omits unchanged re-sent fields and private values", async () => {
    const f = await fixture();
    const created = await runOperation(create, f.ctx, input);
    const row = created.data.formulation;
    const result = await runOperation(update, f.ctx, { formulationId: row.id, expectedVersion: 1,
      name: row.name, biocharRatio: 0.75, description: "Private guidance", lines: [] });
    const [event] = await db.select().from(activityEvents).where(and(
      eq(activityEvents.entityId, row.id), eq(activityEvents.operationId, update.id),
    ));
    expect(event.changedFields).toEqual(["biocharRatio", "description"]);
    expect(event.changes).toEqual({ biocharRatio: { from: "1", to: "0.75" } });
    expect(result.effect?.changedFields).toEqual(event.changedFields);
    expect(result.effect).not.toHaveProperty("changes");
  });

  it("previews create without claiming a key, then replays reordered input and refuses changed input", async () => {
    const f = await fixture(); const options = keyOptions();
    const preview = await runOperation(create, f.ctx, input, { ...options, dryRun: true });
    await expect(readApiFormulation(f.ctx, { id: preview.data.formulation.id })).rejects.toMatchObject({ code: "not_found" });
    expect(await db.select().from(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.organizationId, f.ctx.organizationId))).toEqual([]);
    expect(await db.select().from(activityEvents).where(eq(activityEvents.organizationId, f.ctx.organizationId))).toEqual([]);
    const committed = await runOperation(create, f.ctx, input, options);
    expect(stable(preview.data.formulation)).toEqual(stable(committed.data.formulation));
    const reordered = { lines: [], description: input.description, biocharRatio: 1, name: input.name };
    const replay = await runOperation(create, f.ctx, reordered, options);
    expect(replay.replayed).toBe(true);
    expect(JSON.stringify(representation(replay.data.formulation))).toBe(JSON.stringify(representation(committed.data.formulation)));
    await expect(runOperation(create, f.ctx, { ...input, name: "Other" }, options)).rejects.toMatchObject({ code: "idempotency_key_reused" });
    await expect(runOperation(create, f.ctx, input, { ...options, dryRun: true })).rejects.toMatchObject({ code: "key_already_used" });
  });

  it("previews every existing-row command without changing the row or Activity", async () => {
    const f = await fixture();
    const { formulation: first } = await runOperationInProcess(create, f.ctx, input);
    const commands = [
      { operation: update, input: { formulationId: first.id, expectedVersion: 1, name: "Updated" } },
      { operation: archive, input: { formulationId: first.id, expectedVersion: 2 } },
      { operation: restore, input: { formulationId: first.id, expectedVersion: 3 } },
    ];
    for (const command of commands) {
      const before = await readApiFormulation(f.ctx, { id: first.id });
      const events = await db.select().from(activityEvents).where(eq(activityEvents.entityId, first.id));
      const preview = await runOperation(command.operation, f.ctx, command.input, { dryRun: true });
      expect(await readApiFormulation(f.ctx, { id: first.id })).toEqual(before);
      expect(await db.select().from(activityEvents).where(eq(activityEvents.entityId, first.id))).toEqual(events);
      const committed = await runOperation(command.operation, f.ctx, command.input);
      expect(stable(preview.data.formulation)).toEqual(stable(committed.data.formulation));
    }
    const body = { formulationId: first.id, expectedVersion: 4 };
    expect((await runOperation(remove, f.ctx, body, { dryRun: true })).data).toBeNull();
    expect(await readApiFormulation(f.ctx, { id: first.id })).toMatchObject({ version: 4 });
    expect((await runOperation(remove, f.ctx, body)).data).toBeNull();
  });

  it("reads its uncommitted detail and list through the supplied executor at pool size one", async () => {
    const f = await fixture();
    await db.transaction(async (tx) => {
      const [row] = await tx.insert(formulations).values({ organizationId: f.ctx.organizationId, code: "TX-RECIPE", name: "Transaction recipe" }).returning();
      expect(await readApiFormulation(f.ctx, { id: row.id }, tx)).toMatchObject({ id: row.id });
      expect((await readApiFormulationList(f.ctx, { filters: { code: row.code }, limit: 1 }, tx)).data).toMatchObject([{ id: row.id }]);
    });
  });

  it("parallel duplicate keys produce one row and one Activity entry on a separate-connection pool", async () => {
    const f = await fixture(); const options = { ...keyOptions(), pool };
    vi.resetModules();
    const otherRunner = await import("@/lib/operations/runner");
    const barrier = await openOperationBarrier(barrierPool);
    const body = { ...input, biocharRatio: 0.5, lines: [{ feedstockTypeId: f.ingredientType.id, ratio: 0.5 }] };
    const settle = <T>(promise: Promise<T>) => promise.then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
    let first: ReturnType<typeof settle> | undefined;
    let second: ReturnType<typeof settle> | undefined;
    try {
      await barrier.tx.select().from(feedstockTypes).where(and(eq(feedstockTypes.organizationId, f.ctx.organizationId), eq(feedstockTypes.id, f.ingredientType.id))).for("update");
      first = settle(runOperation(create, f.ctx, body, options));
      await waitForBlockedOperations(barrierPool, barrier.pid, 1);
      second = settle(otherRunner.runOperation(create, f.ctx, body, options));
      await waitForBlockedOperations(barrierPool, barrier.pid, 2);
      expect(await second).toMatchObject({ ok: false, error: { code: "idempotency_in_progress" } });
      await barrier.commit();
    } catch (error) {
      await barrier.rollback();
      await Promise.allSettled([first, second]);
      throw error;
    }
    expect(await first).toMatchObject({ ok: true });
    const replay = await runOperation(create, f.ctx, body, options);
    expect(replay.replayed).toBe(true);
    expect(await db.select().from(formulations).where(and(eq(formulations.organizationId, f.ctx.organizationId), eq(formulations.name, input.name)))).toHaveLength(1);
    expect(await db.select().from(activityEvents).where(eq(activityEvents.entityId, replay.data.formulation.id))).toHaveLength(1);
  });
});
