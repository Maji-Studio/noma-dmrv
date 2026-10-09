import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
vi.hoisted(() => { process.env.DB_POOL_MAX = "1"; });
import { db } from "@/db";
import { storageLocations, productionRuns, productionRunFeedstockDraws, productionRunFeedstocks } from "@/db/schema";
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
const OUTPUT_KG = 20;
const OUTPUT_MOISTURE = 10;
const FEEDSTOCK_DRY_FRACTION = 0.675;
let secondBinId: string;
let outputBinId: string;
let fixture: Awaited<ReturnType<typeof createProductionRunFixture>>;
const input = () => ({
  facilityId: fixture.facilityId, reactorId: fixture.reactorId,
  startTime: new Date("2026-01-01T10:00:00Z"),
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
  const [second] = await db.insert(storageLocations).values({ organizationId: fixture.ctx.organizationId, facilityId: fixture.facilityId,
    code: "FS-SECOND", name: "Second source", type: "feedstock_bin", feedstockTypeId: fixture.feedstockTypeId }).returning();
  secondBinId = second.id;
  const [output] = await db.insert(storageLocations).values({ organizationId: fixture.ctx.organizationId, facilityId: fixture.facilityId,
    code: "BC-OUTPUT", name: "Run output", type: "biochar_bin" }).returning();
  outputBinId = output.id;
  await runOperation(logFeedstockDelivery, fixture.ctx, { ...fixture.input(INTAKE_KG), allocations: [{ storageLocationId: secondBinId, allocatedWetMassKg: INTAKE_KG }] });
});
afterAll(async () => { if (fixture) await removeIntakeFixture(fixture); });

describe("production operations at pool size one", { timeout: SUITE_TIMEOUT_MS }, () => {
  it("creates, updates and deletes draws without waiting on its own connection", async () => {
    expect(db.$client.options.max).toBe(1);
    const started = Date.now();
    const created = await runOperation(startProductionRun, fixture.ctx, input());
    expect(created.data.code).toMatch(/^PR-\d{2}-\d{3,}$/);
    expect(created.data.version).toBe(1);
    expect(created).not.toHaveProperty("stockEffects");
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

  it("reports source wet/dry loss and completed output dry gain before rollback", async () => {
    const result = await runOperation(startProductionRun, fixture.ctx, {
      ...input(), status: "complete", biocharStorageLocationId: outputBinId,
      biocharOutputKg: OUTPUT_KG, biocharMoisturePercent: OUTPUT_MOISTURE, feedstockMoisturePercent: 32.5,
    }, { dryRun: true });
    expect(result.stockEffects).toHaveLength(2);
    expect(result.stockEffects).toEqual(expect.arrayContaining([
      expect.objectContaining({ storageLocationId: fixture.binId, before: { wetKg: INTAKE_KG, dryKg: INTAKE_KG * FEEDSTOCK_DRY_FRACTION },
        after: { wetKg: INTAKE_KG - DRAW_KG, dryKg: (INTAKE_KG - DRAW_KG) * FEEDSTOCK_DRY_FRACTION },
        delta: { wetKg: -DRAW_KG, dryKg: -DRAW_KG * FEEDSTOCK_DRY_FRACTION } }),
      expect.objectContaining({ storageLocationId: outputBinId, before: { wetKg: null, dryKg: 0 },
        after: { wetKg: null, dryKg: OUTPUT_KG * (1 - OUTPUT_MOISTURE / 100) },
        delta: { wetKg: null, dryKg: OUTPUT_KG * (1 - OUTPUT_MOISTURE / 100) } }),
    ]));
    expect(await stock()).toBe(INTAKE_KG);
    expect(await rows()).toEqual([[], [], []]);
  });

  it("reports both bins when a dry-run update moves a draw", async () => {
    const created = await runOperation(startProductionRun, fixture.ctx, input());
    const target = { productionRunId: created.data.id, expectedVersion: created.data.version };
    try {
      const result = await runOperation(updateProductionRun, fixture.ctx, { ...target,
        feedstockDraws: [{ storageLocationId: secondBinId, wetMassKg: DRAW_KG }],
      }, { dryRun: true });
      expect(result.stockEffects).toHaveLength(2);
      expect(result.stockEffects).toEqual(expect.arrayContaining([
        expect.objectContaining({ storageLocationId: fixture.binId, delta: { wetKg: DRAW_KG, dryKg: DRAW_KG * FEEDSTOCK_DRY_FRACTION } }),
        expect.objectContaining({ storageLocationId: secondBinId, delta: { wetKg: -DRAW_KG, dryKg: -DRAW_KG * FEEDSTOCK_DRY_FRACTION } }),
      ]));
      expect(await stock()).toBe(INTAKE_KG - DRAW_KG);
      expect(await deriveFeedstockWetStockKg(fixture.ctx, db, secondBinId)).toBe(INTAKE_KG);
    } finally {
      await runOperation(deleteProductionRun, fixture.ctx, target);
    }
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
      const deleted = await runOperation(deleteProductionRun, fixture.ctx, target, { dryRun: true });
      expect(deleted.stockEffects).toMatchObject([{ storageLocationId: fixture.binId, delta: { wetKg: DRAW_KG, dryKg: DRAW_KG * FEEDSTOCK_DRY_FRACTION } }]);
      expect(await rows()).toEqual(before);
      expect(await stock()).toBe(beforeStock);
    } finally {
      await runOperation(deleteProductionRun, fixture.ctx, { productionRunId: created.data.id, expectedVersion: created.data.version });
    }
  });

  it.each(["facilityId", "reactorId", "operatorId", "biocharStorageLocationId", "feedstockDraws"] as const)("reports a missing %s with its field path", async (field) => {
    const missing = "00000000-0000-4000-8000-000000000099";
    const value = field === "feedstockDraws" ? [{ storageLocationId: missing, wetMassKg: DRAW_KG }] : missing;
    await expect(runOperation(startProductionRun, fixture.ctx, { ...input(), [field]: value })).rejects.toMatchObject({
      code: "not_found", issues: [expect.objectContaining({ path: field === "feedstockDraws" ? [field, 0, "storageLocationId"] : [field] })],
    });
  });

  it.each(["update", "delete"] as const)("reports a missing run as plain not_found on %s", async (kind) => {
    const missingInput = { productionRunId: "00000000-0000-4000-8000-000000000099", expectedVersion: 1 };
    await expect(kind === "update" ? runOperation(updateProductionRun, fixture.ctx, missingInput) : runOperation(deleteProductionRun, fixture.ctx, missingInput))
      .rejects.toMatchObject({ code: "not_found", issues: [] });
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
