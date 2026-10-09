import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
vi.hoisted(() => { process.env.DB_POOL_MAX = "1"; });
import { db } from "@/db";
import { productionRuns, productionRunFeedstockDraws, productionRunFeedstocks } from "@/db/schema";
import { deriveFeedstockWetStockKg } from "@/data-access/feedstock-wet-stock";
import { runOperation } from "@/lib/operations/runner";
import { logFeedstockDelivery } from "@/lib/operations/feedstocks";
import { startProductionRun, updateProductionRun, deleteProductionRun } from "@/lib/operations/production-runs";
import { createProductionRunFixture, removeIntakeFixture } from "./helpers/operation-fixture";

const SUITE_TIMEOUT_MS = 30_000;
const NO_SELF_WAIT_MS = 3_000;
const INTAKE_KG = 1000;
const DRAW_KG = 100;
const UPDATED_DRAW_KG = 150;
let fixture: Awaited<ReturnType<typeof createProductionRunFixture>>;
const input = () => ({
  facilityId: fixture.facilityId, reactorId: fixture.reactorId,
  startDate: "2026-01-01", startTime: new Date("2026-01-01T10:00:00Z"),
  endTime: new Date("2026-01-01T11:00:00Z"), status: "draft",
  feedstockDraws: [{ storageLocationId: fixture.binId, wetMassKg: DRAW_KG }],
});
const stock = () => deriveFeedstockWetStockKg(fixture.ctx, db, fixture.binId);
const rows = () => Promise.all([
  db.select().from(productionRuns).where(eq(productionRuns.organizationId, fixture.ctx.organizationId)),
  db.select().from(productionRunFeedstockDraws).where(eq(productionRunFeedstockDraws.organizationId, fixture.ctx.organizationId)),
  db.select().from(productionRunFeedstocks).where(eq(productionRunFeedstocks.organizationId, fixture.ctx.organizationId)),
]);

beforeAll(async () => {
  fixture = await createProductionRunFixture("production-runs");
  await runOperation(logFeedstockDelivery, fixture.ctx, fixture.input(INTAKE_KG));
});
afterAll(async () => { if (fixture) await removeIntakeFixture(fixture); });

describe("production operations at pool size one", { timeout: SUITE_TIMEOUT_MS }, () => {
  it("creates, updates and deletes draws without waiting on its own connection", async () => {
    expect(db.$client.options.max).toBe(1);
    const started = Date.now();
    const created = await runOperation(startProductionRun, fixture.ctx, input());
    expect(created.data.code).toMatch(/^PR-\d{2}-\d{3,}$/);
    expect(created.data.version).toBe(1);
    expect(created.data.feedstockDraws).toHaveLength(1);
    expect(await stock()).toBe(INTAKE_KG - DRAW_KG);
    const updated = await runOperation(updateProductionRun, fixture.ctx, {
      productionRunId: created.data.id, expectedVersion: created.data.version,
      facilityId: fixture.facilityId, reactorId: fixture.reactorId,
      feedstockDraws: [{ storageLocationId: fixture.binId, wetMassKg: UPDATED_DRAW_KG }],
    });
    expect(updated.data.version).toBe(2);
    expect(await stock()).toBe(INTAKE_KG - UPDATED_DRAW_KG);
    await expect(runOperation(updateProductionRun, fixture.ctx, {
      productionRunId: created.data.id, expectedVersion: created.data.version,
    })).rejects.toMatchObject({ code: "stale_version", conflict: { entity: "productionRun", id: created.data.id } });
    await runOperation(deleteProductionRun, fixture.ctx, { productionRunId: updated.data.id, expectedVersion: updated.data.version });
    expect(await rows()).toEqual([[], [], []]);
    expect(await stock()).toBe(INTAKE_KG);
    expect(Date.now() - started).toBeLessThan(NO_SELF_WAIT_MS);
  });

  it("rolls a dry-run create back with no run, draws, allocations or stock change", async () => {
    const before = await rows();
    const beforeStock = await stock();
    const result = await runOperation(startProductionRun, fixture.ctx, input(), { dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.data.feedstockDraws).toHaveLength(1);
    expect(await rows()).toEqual(before);
    expect(await stock()).toBe(beforeStock);
  });

  it("rolls back update and delete previews, including versions and stock", async () => {
    const created = await runOperation(startProductionRun, fixture.ctx, input());
    try {
      const before = await rows();
      const beforeStock = await stock();
      const target = { productionRunId: created.data.id, expectedVersion: created.data.version };
      const updated = await runOperation(updateProductionRun, fixture.ctx, {
        ...target, feedstockDraws: [{ storageLocationId: fixture.binId, wetMassKg: UPDATED_DRAW_KG }],
      }, { dryRun: true });
      expect(updated.data.version).toBe(created.data.version + 1);
      expect(await rows()).toEqual(before);
      expect(await stock()).toBe(beforeStock);
      await runOperation(deleteProductionRun, fixture.ctx, target, { dryRun: true });
      expect(await rows()).toEqual(before);
      expect(await stock()).toBe(beforeStock);
    } finally {
      await runOperation(deleteProductionRun, fixture.ctx, { productionRunId: created.data.id, expectedVersion: created.data.version });
    }
  });

  it("retains the overlap conflict code, message and typed reference", async () => {
    const created = await runOperation(startProductionRun, fixture.ctx, input());
    try {
      await expect(runOperation(startProductionRun, fixture.ctx, input())).rejects.toMatchObject({
        code: "conflict", message: expect.stringContaining(created.data.code),
        conflict: { entity: "productionRun", id: created.data.id, code: created.data.code },
      });
      expect(await stock()).toBe(INTAKE_KG - DRAW_KG);
    } finally {
      await runOperation(deleteProductionRun, fixture.ctx, { productionRunId: created.data.id, expectedVersion: created.data.version });
    }
  });
});
