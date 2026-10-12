/**
 * `record_output_stock_movement` against PostgreSQL: losses and counts on a
 * biochar bin through the operation runner, the optional stock basis
 * (decision 53), the future-time guard (decision 56), bin resolution, request
 * keys and whole-transaction retries. The bin holds R1 (900 kg dry, placed
 * 2026-09-09) and R2 (600 kg dry, placed 2026-09-11).
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { apiIdempotencyRecords, binMovements, outputStockAllocations, outputStockMoistureReadings, storageLocations } from "@/db/schema";
import { getOutputBinAllLayersDryKg } from "@/data-access/output-stock";
import { recordOutputStockMovement } from "@/lib/operations/output-stock";
import { runOperation, runOperationInProcess, type Operation } from "@/lib/operations/runner";
import { cleanupOutputStockFixture } from "./helpers/output-stock-cleanup";
import { seedOutputStockParents } from "./helpers/output-stock-fixture";

type Fixture = Awaited<ReturnType<typeof seedOutputStockParents>>;

const STOCK_TIME = "2026-09-14T12:00:00.000Z";
/** After R1 is placed and before R2 is. */
const BEFORE_R2 = "2026-09-10T12:00:00.000Z";
const BIN_DRY_KG = 1500;
const LOSS_WET_KG = 100;
const LOSS_MOISTURE = 10;
const LOSS_DRY_KG = 90;
const COUNT_MOISTURE = 20;
/** 1250 kg at 20% is 1000 kg of solids: 500 kg short of the bin. */
const PARTIAL_COUNT_WET_KG = 1250;
const PARTIAL_COUNT_DRY_KG = 1000;
/** 2000 kg at 20% is 1600 kg of solids: 100 kg more than the records hold. */
const SURPLUS_COUNT_WET_KG = 2000;
const SURPLUS_SOLIDS_KG = 100;
const FUTURE_MS = 60_000;
const DAY_MS = 86_400_000;
const RETRYABLE = { code: "40001" };
const CREDENTIAL_ID = "cred_output_stock";

const fixtures: Fixture[] = [];
let foreign: Fixture;

async function fixture(): Promise<Fixture> {
  const f = await seedOutputStockParents(db);
  fixtures.push(f);
  return f;
}
async function cleanup(f: Fixture) {
  await db.delete(apiIdempotencyRecords).where(eq(apiIdempotencyRecords.organizationId, f.ctx.organizationId));
  await cleanupOutputStockFixture(db, f.ctx.organizationId);
}
afterEach(async () => { for (const f of fixtures.splice(0)) await cleanup(f); });
beforeAll(async () => { foreign = await seedOutputStockParents(db); });
afterAll(async () => { if (foreign) await cleanup(foreign); });

const loss = (f: Fixture, changes: Record<string, unknown> = {}) => ({
  storageLocationId: f.source.id, kind: "loss", occurredAt: STOCK_TIME, wetMassKg: LOSS_WET_KG, moisturePercent: LOSS_MOISTURE, reason: "E2E spilled", ...changes,
});
const count = (f: Fixture, wetMassKg: number, changes: Record<string, unknown> = {}) => ({
  storageLocationId: f.source.id, kind: "count", occurredAt: STOCK_TIME, wetMassKg, moisturePercent: wetMassKg === 0 ? null : COUNT_MOISTURE, reason: "E2E stock take", ...changes,
});
const stock = (f: Fixture) => getOutputBinAllLayersDryKg(f.ctx, f.source.id, db);
const movements = (f: Fixture) => db.select().from(binMovements).where(eq(binMovements.organizationId, f.ctx.organizationId));
const allocationsOf = (f: Fixture, movementId: string) => db.select().from(outputStockAllocations)
  .where(and(eq(outputStockAllocations.organizationId, f.ctx.organizationId), eq(outputStockAllocations.movementId, movementId)));
const readingsOf = (f: Fixture, movementId: string) => db.select().from(outputStockMoistureReadings)
  .where(and(eq(outputStockMoistureReadings.organizationId, f.ctx.organizationId), eq(outputStockMoistureReadings.movementId, movementId)));
const [r1, r2] = [(f: Fixture) => f.runs[0].id, (f: Fixture) => f.runs[1].id];

describe("losses and counts", () => {
  it("records a loss oldest first and stores the planned basis under a generated key", async () => {
    const f = await fixture();
    const result = await runOperation(recordOutputStockMovement, f.ctx, loss(f));
    expect(result.dryRun).toBe(false);
    expect(result.data.preview.removedDryKg).toBe(LOSS_DRY_KG);
    expect(await stock(f)).toBe(BIN_DRY_KG - LOSS_DRY_KG);
    const [movement] = await movements(f);
    expect(movement).toMatchObject({ id: result.data.movementId, outputKind: "loss", basisFingerprint: result.data.basisFingerprint });
    expect(movement.idempotencyKey).toMatch(/^api:/);
    expect((await allocationsOf(f, movement.id)).map(a => a.productionRunId)).toEqual([r1(f)]);
  });

  it("records a zero count as an empty bin", async () => {
    const f = await fixture();
    const result = await runOperation(recordOutputStockMovement, f.ctx, count(f, 0));
    expect(await stock(f)).toBe(0);
    expect((await allocationsOf(f, result.data.movementId)).map(a => a.productionRunId).sort()).toEqual([r1(f), r2(f)].sort());
    expect(await readingsOf(f, result.data.movementId)).toEqual([]);
  });

  it("draws a partial count's shortfall from the oldest run and resets every remaining layer's moisture", async () => {
    const f = await fixture();
    const result = await runOperation(recordOutputStockMovement, f.ctx, count(f, PARTIAL_COUNT_WET_KG));
    expect(await stock(f)).toBe(PARTIAL_COUNT_DRY_KG);
    expect((await allocationsOf(f, result.data.movementId)).map(a => [a.productionRunId, Number(a.dryMassKg)])).toEqual([[r1(f), BIN_DRY_KG - PARTIAL_COUNT_DRY_KG]]);
    expect((await readingsOf(f, result.data.movementId)).map(r => r.productionRunId).sort()).toEqual([r1(f), r2(f)].sort());
  });

  it("records a surplus count as a discrepancy and never raises stock", async () => {
    const f = await fixture();
    const result = await runOperation(recordOutputStockMovement, f.ctx, count(f, SURPLUS_COUNT_WET_KG));
    expect(result.data.preview.discrepancySolidsKg).toBe(SURPLUS_SOLIDS_KG);
    expect(await stock(f)).toBe(BIN_DRY_KG);
    expect(await allocationsOf(f, result.data.movementId)).toEqual([]);
    expect(await readingsOf(f, result.data.movementId)).toHaveLength(2);
  });
});

describe("dry runs and the optional stock basis (decision 53)", () => {
  it("previews the same movement it writes and rolls back", async () => {
    const f = await fixture();
    const dry = await runOperation(recordOutputStockMovement, f.ctx, loss(f), { dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(dry.stockEffects).toEqual([expect.objectContaining({
      storageLocationId: f.source.id, stockKind: "biochar_bin",
      before: { wetKg: null, dryKg: BIN_DRY_KG }, after: { wetKg: null, dryKg: BIN_DRY_KG - LOSS_DRY_KG }, delta: { wetKg: null, dryKg: -LOSS_DRY_KG },
    })]);
    expect(await movements(f)).toEqual([]);
    expect(await stock(f)).toBe(BIN_DRY_KG);

    const written = await runOperation(recordOutputStockMovement, f.ctx, loss(f, { basisFingerprint: dry.data.basisFingerprint }));
    expect(written.data.basisFingerprint).toBe(dry.data.basisFingerprint);
    expect(written.data.preview.allocations).toEqual(dry.data.preview.allocations);
    expect(await stock(f)).toBe(dry.stockEffects![0].after.dryKg);
  });

  it("refuses a stale fingerprint with stock_basis_changed and the bin conflict, writing nothing", async () => {
    const f = await fixture();
    const dry = await runOperation(recordOutputStockMovement, f.ctx, loss(f), { dryRun: true });
    await runOperation(recordOutputStockMovement, f.ctx, loss(f));
    const before = await movements(f);
    await expect(runOperation(recordOutputStockMovement, f.ctx, loss(f, { basisFingerprint: dry.data.basisFingerprint })))
      .rejects.toMatchObject({ code: "stock_basis_changed", conflict: { entity: "storageLocation", id: f.source.id } });
    expect(await movements(f)).toHaveLength(before.length);
    expect(await stock(f)).toBe(BIN_DRY_KG - LOSS_DRY_KG);
  });

  it("acts on current stock under the bin lock without a fingerprint", async () => {
    const f = await fixture();
    await runOperation(recordOutputStockMovement, f.ctx, loss(f), { dryRun: true });
    await runOperation(recordOutputStockMovement, f.ctx, loss(f));
    await runOperation(recordOutputStockMovement, f.ctx, loss(f));
    expect(await stock(f)).toBe(BIN_DRY_KG - LOSS_DRY_KG - LOSS_DRY_KG);
  });

  it("answers a shortage as insufficient_stock with solids metadata", async () => {
    const f = await fixture();
    await expect(runOperation(recordOutputStockMovement, f.ctx, loss(f, { wetMassKg: BIN_DRY_KG * 2, moisturePercent: 0 })))
      .rejects.toMatchObject({ code: "insufficient_stock", issues: [{ path: ["wetMassKg"], meta: { storageLocationId: f.source.id, availableSolidsKg: BIN_DRY_KG, requestedSolidsKg: BIN_DRY_KG * 2 } }] });
  });
});

describe("event times (decision 56)", () => {
  it("refuses a future occurredAt, as an instant or a facility-local time", async () => {
    const f = await fixture();
    const future = new Date(Date.now() + FUTURE_MS).toISOString();
    await expect(runOperation(recordOutputStockMovement, f.ctx, loss(f, { occurredAt: future })))
      .rejects.toMatchObject({ code: "validation_failed", issues: [{ path: ["occurredAt"] }] });
    const tomorrow = new Date(Date.now() + DAY_MS).toISOString().slice(0, 10);
    await expect(runOperation(recordOutputStockMovement, f.ctx, loss(f, { occurredAt: { date: tomorrow, time: "12:00" } })))
      .rejects.toMatchObject({ code: "validation_failed", issues: [{ path: ["occurredAt"] }] });
    await expect(runOperation(recordOutputStockMovement, f.ctx, loss(f, { occurredAt: future }), { dryRun: true }))
      .rejects.toMatchObject({ code: "validation_failed" });
    expect(await movements(f)).toEqual([]);
  });

  it("lets a correction keep a future-dated entry's own time, and refuses a new future time", async () => {
    const f = await fixture();
    const first = await runOperationInProcess(recordOutputStockMovement, f.ctx, loss(f));
    // A delivery dated later today carries a future time; stand in for one with a direct update.
    const later = new Date(Date.now() + DAY_MS);
    await db.update(binMovements).set({ occurredAt: later }).where(eq(binMovements.id, first.movementId));
    const correction = (occurredAt: string) => loss(f, { occurredAt, correctsMovementId: first.movementId, wetMassKg: LOSS_WET_KG / 2, reason: "E2E corrected" });
    await expect(runOperationInProcess(recordOutputStockMovement, f.ctx, correction(new Date(later.getTime() + FUTURE_MS).toISOString())))
      .rejects.toMatchObject({ code: "validation_failed", issues: [{ path: ["occurredAt"] }] });
    await expect(runOperationInProcess(recordOutputStockMovement, f.ctx, correction(later.toISOString())))
      .resolves.toMatchObject({ movementId: expect.any(String) });
  });

  it("allows a backdated movement, read in the facility zone", async () => {
    const f = await fixture();
    const result = await runOperation(recordOutputStockMovement, f.ctx, loss(f, { occurredAt: { date: BEFORE_R2.slice(0, 10), time: "12:00" } }));
    const [movement] = await movements(f);
    expect(movement.occurredAt?.toISOString()).toBe(BEFORE_R2);
    expect((await allocationsOf(f, result.data.movementId)).map(a => a.productionRunId)).toEqual([r1(f)]);
  });
});

describe("bin resolution", () => {
  it("refuses a feedstock bin", async () => {
    const f = await fixture();
    const [feedstockBin] = await db.insert(storageLocations).values({ organizationId: f.ctx.organizationId, facilityId: f.facility.id,
      feedstockTypeId: f.ingredientType.id, code: `E2E-OS-FS-${f.tag}`, name: `E2E Feedstock ${f.tag}`, type: "feedstock_bin" }).returning();
    await expect(runOperation(recordOutputStockMovement, f.ctx, loss(f, { storageLocationId: feedstockBin.id })))
      .rejects.toMatchObject({ code: "validation_failed", issues: [{ path: ["storageLocationId"] }] });
  });

  it("answers a foreign-organization or archived bin as not found", async () => {
    const f = await fixture();
    await expect(runOperation(recordOutputStockMovement, foreign.ctx, loss(f)))
      .rejects.toMatchObject({ code: "not_found", issues: [{ path: ["storageLocationId"] }] });
    await db.update(storageLocations).set({ archivedAt: new Date() }).where(and(eq(storageLocations.organizationId, f.ctx.organizationId), eq(storageLocations.id, f.bin.id)));
    await expect(runOperation(recordOutputStockMovement, f.ctx, loss(f, { storageLocationId: f.bin.id })))
      .rejects.toMatchObject({ code: "not_found" });
    expect(await movements(f)).toEqual([]);
  });

  it("answers a bin outside the facility the form named as not found", async () => {
    const f = await fixture();
    await expect(runOperation(recordOutputStockMovement, f.ctx, loss(f, { facilityId: foreign.facility.id })))
      .rejects.toMatchObject({ code: "not_found" });
  });
});

describe("request keys", () => {
  it("generates a fresh movement key per execution, so a keyless repeat posts again", async () => {
    const f = await fixture();
    const first = await runOperation(recordOutputStockMovement, f.ctx, loss(f));
    const second = await runOperation(recordOutputStockMovement, f.ctx, loss(f));
    expect(second.data.movementId).not.toBe(first.data.movementId);
    const keys = (await movements(f)).map(m => m.idempotencyKey);
    expect(new Set(keys).size).toBe(2);
    expect(keys.every(key => key?.startsWith("api:"))).toBe(true);
  });

  it("replays an API request key from the runner record without a second movement", async () => {
    const f = await fixture();
    const idempotency = { credentialId: CREDENTIAL_ID, key: randomUUID() };
    const first = await runOperation(recordOutputStockMovement, f.ctx, loss(f), { idempotency });
    const replay = await runOperation(recordOutputStockMovement, f.ctx, loss(f), { idempotency });
    expect(replay.replayed).toBe(true);
    expect(replay.data.movementId).toBe(first.data.movementId);
    expect(await movements(f)).toHaveLength(1);
  });

  it("replays a form request key, and refuses it with different values", async () => {
    const f = await fixture();
    const idempotencyKey = randomUUID();
    const first = await runOperationInProcess(recordOutputStockMovement, f.ctx, loss(f, { facilityId: f.facility.id, idempotencyKey }));
    const replay = await runOperationInProcess(recordOutputStockMovement, f.ctx, loss(f, { facilityId: f.facility.id, idempotencyKey }));
    expect(replay.movementId).toBe(first.movementId);
    expect(await movements(f)).toHaveLength(1);
    await expect(runOperationInProcess(recordOutputStockMovement, f.ctx, loss(f, { facilityId: f.facility.id, idempotencyKey, wetMassKg: LOSS_WET_KG + 1 })))
      .rejects.toMatchObject({ code: "conflict" });
  });
});

describe("whole-transaction retries (astra finding 5)", () => {
  it("commits one movement with the final attempt's effects after a retryable failure once writes began", async () => {
    const f = await fixture();
    let attempts = 0;
    const flaky: Operation<typeof recordOutputStockMovement.input, Awaited<ReturnType<typeof recordOutputStockMovement.execute>>> = {
      ...recordOutputStockMovement,
      execute: async (scope, input) => {
        const posted = await recordOutputStockMovement.execute(scope, input);
        attempts += 1;
        // The movement, its allocations and readings are written; abort before COMMIT.
        if (attempts === 1) throw RETRYABLE;
        return posted;
      },
    };
    const result = await runOperation(flaky, f.ctx, count(f, PARTIAL_COUNT_WET_KG));
    expect(attempts).toBe(2);
    const saved = await movements(f);
    expect(saved.map(m => m.id)).toEqual([result.data.movementId]);
    expect(await stock(f)).toBe(PARTIAL_COUNT_DRY_KG);
    const allocations = await db.select().from(outputStockAllocations).where(eq(outputStockAllocations.organizationId, f.ctx.organizationId));
    expect(allocations.map(a => a.movementId)).toEqual([result.data.movementId]);
    const readings = await db.select().from(outputStockMoistureReadings).where(eq(outputStockMoistureReadings.organizationId, f.ctx.organizationId));
    expect(new Set(readings.map(r => r.movementId))).toEqual(new Set([result.data.movementId]));
    // No allocation outlives its movement.
    const orphans = await db.execute<{ count: number }>(sql`select count(*)::int as count from output_stock_allocations a
      where a.organization_id = ${f.ctx.organizationId} and not exists (select 1 from bin_movements m where m.id = a.movement_id)`);
    expect(orphans.rows[0].count).toBe(0);
  });

  it("keeps a form request key across retries and posts once", async () => {
    const f = await fixture();
    let attempts = 0;
    const flaky: Operation<typeof recordOutputStockMovement.input, Awaited<ReturnType<typeof recordOutputStockMovement.execute>>> = {
      ...recordOutputStockMovement,
      execute: async (scope, input) => {
        const posted = await recordOutputStockMovement.execute(scope, input);
        if (++attempts === 1) throw RETRYABLE;
        return posted;
      },
    };
    const idempotencyKey = randomUUID();
    await runOperation(flaky, f.ctx, loss(f, { facilityId: f.facility.id, idempotencyKey }));
    const saved = await movements(f);
    expect(saved.map(m => m.idempotencyKey)).toEqual([idempotencyKey]);
    expect(await db.select().from(outputStockAllocations).where(inArray(outputStockAllocations.movementId, saved.map(m => m.id)))).toHaveLength(1);
    expect(await stock(f)).toBe(BIN_DRY_KG - LOSS_DRY_KG);
  });
});
