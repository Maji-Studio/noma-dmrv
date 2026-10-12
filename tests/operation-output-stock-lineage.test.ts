/**
 * Decision 51: every layer whose moisture reading a movement changes passes
 * the certification-lineage guard, not only the layers it draws from. The
 * biochar bin holds R1 (900 kg dry, placed 2026-09-09) and R2 (600 kg dry,
 * placed 2026-09-11); R2 belongs to a Removal. Counts that never draw from R2
 * but reset its reading, and a correction that removes R2's original reading,
 * are refused with `certification_locked`. Without a submitted artifact the
 * same lineage is open and the same movements save. A product bin's layers
 * are products: a count resetting a certified product's reading is refused
 * the same way.
 */
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { binMovements, storageLocations } from "@/db/schema";
import { createBiocharProduct } from "@/data-access/biochar-product-create";
import { previewOutputStock } from "@/data-access/output-stock-operations";
import { recordOutputStockMovement } from "@/lib/operations/output-stock";
import { runOperation, runOperationInProcess } from "@/lib/operations/runner";
import { certifyOutputLineage, cleanupCertifiedOutputLineage, LINEAGE_LOCKED_COPY } from "./helpers/certified-output-lineage";
import { cleanupOutputStockFixture } from "./helpers/output-stock-cleanup";
import { seedOutputStockParents } from "./helpers/output-stock-fixture";
import { withProductStockFingerprint } from "./helpers/product-stock-preview-fixture";

type Fixture = Awaited<ReturnType<typeof seedOutputStockParents>>;

const STOCK_TIME = "2026-09-14T12:00:00.000Z";
/** After R1 is placed and before R2 is: a count then sees R1 alone. */
const BEFORE_R2 = "2026-09-10T12:00:00.000Z";
const COUNT_MOISTURE = 20;
/** 1875 kg at 20% is exactly the bin's 1500 kg of solids: no draw, readings on R1 and R2. */
const EVEN_COUNT_WET_KG = 1875;
/** 1250 kg at 20% is 1000 kg of solids: 500 kg drawn from R1, readings on R1 and R2. */
const PARTIAL_COUNT_WET_KG = 1250;
/** 1125 kg at 20% is R1's 900 kg of solids. */
const R1_COUNT_WET_KG = 1125;
/** A Pure biochar product of 500 kg wet at 10%, drawn from R1: 450 kg of solids in the product bin. */
const PRODUCT_PLACED_AT = "2026-09-12T12:00:00.000Z";
const PRODUCT_WET_KG = 500;
const PRODUCT_MOISTURE = 10;
/** 500 kg at 10% is the product's 450 kg of solids: no draw, a reading on the product. */
const EVEN_PRODUCT_COUNT_WET_KG = 500;
/** 400 kg at 10% is 360 kg of solids: 90 kg drawn from the product, a reading on what is left. */
const PARTIAL_PRODUCT_COUNT_WET_KG = 400;

const fixtures: Fixture[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await cleanupCertifiedOutputLineage(f.ctx.organizationId);
    await cleanupOutputStockFixture(db, f.ctx.organizationId);
  }
});

async function fixture(): Promise<Fixture> {
  const f = await seedOutputStockParents(db);
  fixtures.push(f);
  return f;
}

/** R2 in a credit batch whose applied slice belongs to a Removal; `submitted` locks it. */
const certifyR2 = (f: Fixture, submitted: boolean) => certifyOutputLineage(f, { runId: f.runs[1].id, submitted });

const count = (f: Fixture, wetMassKg: number, changes: Record<string, unknown> = {}) => ({
  storageLocationId: f.source.id, kind: "count", occurredAt: STOCK_TIME, wetMassKg, moisturePercent: COUNT_MOISTURE, reason: "E2E stock take", ...changes,
});
const movementCount = async (f: Fixture) => (await db.select().from(binMovements).where(eq(binMovements.organizationId, f.ctx.organizationId))).length;
const locked = { code: "certification_locked", message: expect.stringContaining(LINEAGE_LOCKED_COPY) };

/** A count posted while R2 was open, then R2 certified, then the form's correction of it. */
async function correctableCount(f: Fixture) {
  const original = await runOperation(recordOutputStockMovement, f.ctx, count(f, EVEN_COUNT_WET_KG));
  await certifyR2(f, true);
  return original.data.movementId;
}
async function formCorrection(f: Fixture, correctsMovementId: string, changes: { occurredAt: string; wetMassKg: number }) {
  const input = { storageLocationId: f.source.id, facilityId: f.facility.id, kind: "count" as const, moisturePercent: COUNT_MOISTURE, correctsMovementId, ...changes };
  const preview = await previewOutputStock(f.ctx, input);
  return { preview, post: () => runOperationInProcess(recordOutputStockMovement, f.ctx, { ...input, expectedProductVersions: preview.expectedProductVersions,
    basisFingerprint: preview.basisFingerprint, idempotencyKey: randomUUID(), reason: "E2E correction" }) };
}

describe("counts on a bin holding certified runs", () => {
  it("refuses a zero-draw count that only resets a certified run's reading", async () => {
    const f = await fixture();
    await certifyR2(f, true);
    await expect(runOperation(recordOutputStockMovement, f.ctx, count(f, EVEN_COUNT_WET_KG))).rejects.toMatchObject(locked);
    expect(await movementCount(f)).toBe(0);
  });

  it("refuses a partial count that draws only from an open run but resets a certified one", async () => {
    const f = await fixture();
    await certifyR2(f, true);
    await expect(runOperation(recordOutputStockMovement, f.ctx, count(f, PARTIAL_COUNT_WET_KG))).rejects.toMatchObject(locked);
    await expect(runOperation(recordOutputStockMovement, f.ctx, count(f, PARTIAL_COUNT_WET_KG), { dryRun: true })).rejects.toMatchObject(locked);
    expect(await movementCount(f)).toBe(0);
  });

  it("allows a count timed before the certified run reached the bin", async () => {
    const f = await fixture();
    await certifyR2(f, true);
    await runOperation(recordOutputStockMovement, f.ctx, count(f, R1_COUNT_WET_KG, { occurredAt: BEFORE_R2 }));
    expect(await movementCount(f)).toBe(1);
  });

  it("saves the same counts while the lineage has no submitted artifact", async () => {
    const f = await fixture();
    await certifyR2(f, false);
    await runOperation(recordOutputStockMovement, f.ctx, count(f, EVEN_COUNT_WET_KG));
    await runOperation(recordOutputStockMovement, f.ctx, count(f, PARTIAL_COUNT_WET_KG));
    expect(await movementCount(f)).toBe(2);
  });
});

describe("form corrections on a bin holding certified runs", () => {
  it("refuses a correction whose replacement resets the certified run's reading, and the preview names the blocker", async () => {
    const f = await fixture();
    const original = await correctableCount(f);
    const before = await movementCount(f);
    const { preview, post } = await formCorrection(f, original, { occurredAt: STOCK_TIME, wetMassKg: EVEN_COUNT_WET_KG - COUNT_MOISTURE });
    expect(preview.blockingMessage).toContain("certification");
    await expect(post()).rejects.toMatchObject(locked);
    expect(await movementCount(f)).toBe(before);
  });

  it("refuses a backdated correction that only removes the certified run's original reading", async () => {
    const f = await fixture();
    const original = await correctableCount(f);
    const before = await movementCount(f);
    // At this time the bin held R1 alone, so the replacement records no reading for R2.
    const { post } = await formCorrection(f, original, { occurredAt: BEFORE_R2, wetMassKg: R1_COUNT_WET_KG });
    await expect(post()).rejects.toMatchObject(locked);
    expect(await movementCount(f)).toBe(before);
  });
});

/**
 * A Pure product bin holding one product drawn from R1. The product joins
 * R1's certified lineage through the application's share of it.
 */
async function productBin(f: Fixture, submitted: boolean) {
  const [bin] = await db.insert(storageLocations).values({ organizationId: f.ctx.organizationId, facilityId: f.facility.id, formulationId: f.pure.id,
    code: `E2E-OSL-PB-${f.tag}`, name: `E2E Pure bin ${f.tag}`, type: "product_bin" }).returning();
  const product = await createBiocharProduct(f.ctx, await withProductStockFingerprint(f.ctx, { code: `E2E-OSL-P-${f.tag}`, facilityId: f.facility.id,
    formulationId: f.pure.id, placedAt: PRODUCT_PLACED_AT, sourceBiocharStorageLocationId: f.source.id, storageLocationId: bin.id,
    massKg: PRODUCT_WET_KG, moistureContentPercent: PRODUCT_MOISTURE, waterAddedKg: 0, idempotencyKey: randomUUID(), composition: {} }));
  await certifyOutputLineage(f, { runId: f.runs[0].id, productId: product.id, deliveryBinId: bin.id, submitted });
  return bin;
}
const productCount = (binId: string, wetMassKg: number) => ({
  storageLocationId: binId, kind: "count", occurredAt: STOCK_TIME, wetMassKg, moisturePercent: PRODUCT_MOISTURE, reason: "E2E product stock take",
});
const binMovementCount = async (f: Fixture, binId: string) => (await db.select().from(binMovements)
  .where(and(eq(binMovements.organizationId, f.ctx.organizationId), eq(binMovements.storageLocationId, binId)))).length;

describe("counts on a product bin holding a certified product", () => {
  it("refuses a zero-draw count and a partial count that reset the certified product's reading", async () => {
    const f = await fixture();
    const bin = await productBin(f, true);
    await expect(runOperation(recordOutputStockMovement, f.ctx, productCount(bin.id, EVEN_PRODUCT_COUNT_WET_KG))).rejects.toMatchObject(locked);
    await expect(runOperation(recordOutputStockMovement, f.ctx, productCount(bin.id, PARTIAL_PRODUCT_COUNT_WET_KG))).rejects.toMatchObject(locked);
    expect(await binMovementCount(f, bin.id)).toBe(0);
  });

  it("saves the same counts while the product's lineage has no submitted artifact", async () => {
    const f = await fixture();
    const bin = await productBin(f, false);
    const even = await runOperation(recordOutputStockMovement, f.ctx, productCount(bin.id, EVEN_PRODUCT_COUNT_WET_KG));
    expect(even.data.preview.removedDryKg).toBe(0);
    await runOperation(recordOutputStockMovement, f.ctx, productCount(bin.id, PARTIAL_PRODUCT_COUNT_WET_KG));
    expect(await binMovementCount(f, bin.id)).toBe(2);
  });
});
