/**
 * The form's credit batch preview (#1350) agrees with what saving does: each
 * record is previewed, saved through the real writer, and read back with the
 * saved line's own read. Real PostgreSQL, the worktree's test database.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  creditBatchApplications, creditBatchProductionRuns, creditBatches, feedstockTypes, productionProcesses,
} from "@/db/schema";
import { createBiocharProduct } from "@/data-access/biochar-product-create";
import { deriveCompositionSourceBiocharMassKg } from "@/data-access/biochar-product-composition";
import { previewRecordCreditBatches } from "@/data-access/record-credit-batch-preview";
import { getRecordCreditBatches } from "@/data-access/record-credit-batches";
import { previewOutputStock } from "@/data-access/output-stock-operations";
import { recordOrder } from "@/lib/operations/orders";
import { runOperationInProcess } from "@/lib/operations/runner";
import { createTestApplication } from "./helpers/application-writers";
import { createDelivery } from "./helpers/create-delivery";
import { cleanupOutputStockFixture } from "./helpers/output-stock-cleanup";
import { seedOutputStockParents } from "./helpers/output-stock-fixture";
import { withProductStockFingerprint } from "./helpers/product-stock-preview-fixture";

const MOISTURE = 10;
const INGREDIENT_KG = 200;
/** After both runs ended (Sep 9 and Sep 11). */
const PLACED_AT = "2026-09-12T12:00:00.000Z";
const SECOND_PLACED_AT = "2026-09-12T13:00:00.000Z";
const DELIVERED_AT = "2026-09-14T12:00:00.000Z";
const SMALL_BLEND_KG = 700;
const LARGE_BLEND_KG = 1000;
const DELIVERY_WET_KG = 300;
const DELIVERY_MOISTURE = 30;
const APPLIED_KG = 100;
const TEST_TIMEOUT_MS = 30_000;
const organizations: string[] = [];

afterAll(async () => {
  for (const organizationId of organizations) {
    // The FIFO cleanup leaves credit batch rows; they go first.
    await db.delete(creditBatchApplications).where(eq(creditBatchApplications.organizationId, organizationId));
    await db.delete(creditBatchProductionRuns).where(eq(creditBatchProductionRuns.organizationId, organizationId));
    await db.delete(creditBatches).where(eq(creditBatches.organizationId, organizationId));
    await db.delete(productionProcesses).where(eq(productionProcesses.organizationId, organizationId));
    await cleanupOutputStockFixture(db, organizationId);
  }
});

/** Run 1 in an early September batch, run 2 in a late one. */
async function fixture() {
  const f = await seedOutputStockParents(db);
  organizations.push(f.ctx.organizationId);
  const org = { organizationId: f.ctx.organizationId };
  const [fuelType] = await db.select().from(feedstockTypes).where(and(
    eq(feedstockTypes.organizationId, f.ctx.organizationId), eq(feedstockTypes.code, `E2E-FIFO-FUEL-${f.tag}`)));
  const [process] = await db.insert(productionProcesses).values({
    ...org, facilityId: f.facility.id, feedstockTypeId: fuelType.id, establishedAt: new Date("2026-09-01T00:00:00Z"),
  }).returning();
  const [early, late] = await db.insert(creditBatches).values([
    { startDate: "2026-09-01", endDate: "2026-09-10", code: `CB-EARLY-${f.tag}` },
    { startDate: "2026-09-11", endDate: "2026-09-30", code: `CB-LATE-${f.tag}` },
  ].map(window => ({ ...org, ...window, facilityId: f.facility.id, feedstockTypeId: fuelType.id, productionProcessId: process.id }))).returning();
  await db.insert(creditBatchProductionRuns).values([
    { ...org, productionRunId: f.runs[0].id, creditBatchId: early.id },
    { ...org, productionRunId: f.runs[1].id, creditBatchId: late.id },
  ]);
  return { ...f, early, late };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

const ids = (batches: { id: string }[]) => batches.map(batch => batch.id);

function productInput(f: Fixture, blendKg: number, placedAt: string) {
  const composition = { ingredients: [{ formulationIngredientId: f.ingredient.id, feedstockTypeId: f.ingredientType.id, massKg: INGREDIENT_KG, moistureContentPercent: 60 }] };
  const sourceWetKg = deriveCompositionSourceBiocharMassKg(blendKg, composition);
  if (sourceWetKg == null) throw new Error("Fixture blend has no source biochar");
  return {
    sourceWetKg,
    data: {
      code: `E2E-PREVIEW-P-${randomUUID().slice(0, 6)}`, facilityId: f.facility.id, formulationId: f.recipe.id, placedAt,
      sourceBiocharStorageLocationId: f.source.id, storageLocationId: f.bin.id,
      massKg: blendKg, moistureContentPercent: MOISTURE, waterAddedKg: 0, idempotencyKey: randomUUID(), composition,
    },
  };
}

/** Previews a product draw, saves it, and reads the saved line back. */
async function previewThenSaveProduct(f: Fixture, blendKg: number, placedAt: string) {
  const { sourceWetKg, data } = productInput(f, blendKg, placedAt);
  const preview = await previewRecordCreditBatches(f.ctx, {
    kind: "biochar-product", bin: { storageLocationId: f.source.id, facilityId: f.facility.id, occurredAt: placedAt },
    draw: { wetMassKg: sourceWetKg, moisturePercent: MOISTURE },
  });
  const product = await createBiocharProduct(f.ctx, await withProductStockFingerprint(f.ctx, data));
  const saved = await getRecordCreditBatches(f.ctx, { kind: "biochar-product", id: product.id });
  return { preview, saved, product };
}

describe("credit batch preview agrees with the save (real database)", () => {
  it("previews a product draw, a delivery and an application exactly as saving assigns them", async () => {
    const f = await fixture();

    // Before the mass is known, the bin holds both runs, so either batch is possible.
    const binOnly = await previewRecordCreditBatches(f.ctx, {
      kind: "biochar-product", bin: { storageLocationId: f.source.id, facilityId: f.facility.id, occurredAt: PLACED_AT }, draw: null,
    });
    expect(binOnly).toMatchObject({ exact: false, heldOut: false, sourceRunCount: 2, unbatchedRunCount: 0 });
    expect(ids(binOnly.batches)).toEqual([f.early.id, f.late.id]);

    // Oldest first: a small draw stays inside run 1.
    const small = await previewThenSaveProduct(f, SMALL_BLEND_KG, PLACED_AT);
    expect(small.preview.exact).toBe(true);
    expect(ids(small.preview.batches)).toEqual([f.early.id]);
    expect(small.saved).toEqual({ batches: small.preview.batches, heldOut: false });

    // A larger draw empties run 1 and reaches run 2.
    const large = await previewThenSaveProduct(f, LARGE_BLEND_KG, SECOND_PLACED_AT);
    expect(ids(large.preview.batches)).toEqual([f.early.id, f.late.id]);
    expect(large.saved).toEqual({ batches: large.preview.batches, heldOut: false });

    // A delivery draws the oldest product first, which holds run 1 only.
    const order = await runOperationInProcess(recordOrder, f.ctx, {
      facilityId: f.facility.id, customerId: f.customer.id, customerLocationId: f.location.id,
      formulationId: f.recipe.id, orderDate: "2026-09-12", quantityKg: 2000, packaging: "loose",
    });
    const bin = { storageLocationId: f.bin.id, facilityId: f.facility.id, occurredAt: DELIVERED_AT };
    const draw = { wetMassKg: DELIVERY_WET_KG, moisturePercent: DELIVERY_MOISTURE };
    const deliveryBinOnly = await previewRecordCreditBatches(f.ctx, { kind: "delivery", bin, draw: null });
    expect(deliveryBinOnly.exact).toBe(false);
    expect(ids(deliveryBinOnly.batches)).toEqual([f.early.id, f.late.id]);
    const deliveryPreview = await previewRecordCreditBatches(f.ctx, { kind: "delivery", bin, draw });
    expect(deliveryPreview.exact).toBe(true);
    expect(ids(deliveryPreview.batches)).toEqual([f.early.id]);
    const stock = await previewOutputStock(f.ctx, { ...bin, kind: "delivery", ...draw });
    const delivery = await createDelivery(f.ctx, {
      code: `E2E-PREVIEW-D-${f.tag}`, orderId: order.id, facilityId: f.facility.id,
      deliveryDate: new Date(DELIVERED_AT), storageLocationId: f.bin.id,
      deliveredWetMassKg: DELIVERY_WET_KG, moistureContentPercent: DELIVERY_MOISTURE,
      idempotencyKey: randomUUID(), basisFingerprint: stock.basisFingerprint,
    });
    expect(await getRecordCreditBatches(f.ctx, { kind: "delivery", id: delivery.id }))
      .toEqual({ batches: deliveryPreview.batches, heldOut: false });

    // An application takes proportional shares of the saved truck.
    const before = await previewRecordCreditBatches(f.ctx, { kind: "application", deliveryId: delivery.id, appliedWetMassKg: null, applicationId: null });
    expect(before).toMatchObject({ exact: false, heldOut: false });
    expect(ids(before.batches)).toEqual([f.early.id]);
    const applicationPreview = await previewRecordCreditBatches(f.ctx, {
      kind: "application", deliveryId: delivery.id, appliedWetMassKg: APPLIED_KG, applicationId: null,
    });
    expect(applicationPreview.exact).toBe(true);
    const application = await createTestApplication(f.ctx, {
      code: `E2E-PREVIEW-A-${f.tag}`, deliveryId: delivery.id, applicationDate: new Date(DELIVERED_AT),
      appliedWetMassKg: APPLIED_KG, fieldSizeHa: 1,
    });
    expect(await getRecordCreditBatches(f.ctx, { kind: "application", id: application.id }))
      .toEqual({ batches: applicationPreview.batches, heldOut: false });

    // An amount the save would refuse falls back to what the delivery has left.
    const tooMuch = await previewRecordCreditBatches(f.ctx, {
      kind: "application", deliveryId: delivery.id, appliedWetMassKg: DELIVERY_WET_KG * 2, applicationId: null,
    });
    expect(tooMuch.exact).toBe(false);
    expect(ids(tooMuch.batches)).toEqual([f.early.id]);
  }, TEST_TIMEOUT_MS);

  it("counts runs in no batch, and names none when no source run is batched", async () => {
    const f = await fixture();
    await db.delete(creditBatchProductionRuns).where(and(
      eq(creditBatchProductionRuns.organizationId, f.ctx.organizationId),
      inArray(creditBatchProductionRuns.productionRunId, [f.runs[1].id]),
    ));
    const binOnly = await previewRecordCreditBatches(f.ctx, {
      kind: "biochar-product", bin: { storageLocationId: f.source.id, facilityId: f.facility.id, occurredAt: PLACED_AT }, draw: null,
    });
    expect(binOnly).toMatchObject({ exact: false, sourceRunCount: 2, unbatchedRunCount: 1 });
    expect(ids(binOnly.batches)).toEqual([f.early.id]);

    await db.delete(creditBatchProductionRuns).where(eq(creditBatchProductionRuns.organizationId, f.ctx.organizationId));
    const { preview, saved } = await previewThenSaveProduct(f, SMALL_BLEND_KG, PLACED_AT);
    expect(preview).toMatchObject({ batches: [], exact: true, unbatchedRunCount: 1 });
    expect(saved).toEqual({ batches: [], heldOut: false });
  }, TEST_TIMEOUT_MS);

  it("plans an over-draw as the bin's held stock, and an empty time as none", async () => {
    const f = await fixture();
    const bin = { storageLocationId: f.source.id, facilityId: f.facility.id };
    const overDraw = await previewRecordCreditBatches(f.ctx, {
      kind: "biochar-product", bin: { ...bin, occurredAt: PLACED_AT }, draw: { wetMassKg: 100_000, moisturePercent: MOISTURE },
    });
    expect(overDraw.exact).toBe(false);
    expect(ids(overDraw.batches)).toEqual([f.early.id, f.late.id]);
    // Before either run ended, the bin holds nothing.
    const empty = await previewRecordCreditBatches(f.ctx, {
      kind: "biochar-product", bin: { ...bin, occurredAt: "2026-09-01T00:00:00.000Z" }, draw: null,
    });
    expect(empty).toMatchObject({ batches: [], sourceRunCount: 0 });
  }, TEST_TIMEOUT_MS);

  it("hides another organization's bin and delivery", async () => {
    const f = await fixture();
    const other = { ...f.ctx, organizationId: `e2e-other-${randomUUID()}` };
    await expect(previewRecordCreditBatches(other, {
      kind: "delivery", bin: { storageLocationId: f.bin.id, facilityId: f.facility.id, occurredAt: DELIVERED_AT }, draw: null,
    })).rejects.toThrow(/not found/i);
    await expect(previewRecordCreditBatches(other, {
      kind: "application", deliveryId: randomUUID(), appliedWetMassKg: null, applicationId: null,
    })).rejects.toThrow(/not found/i);
    await expect(previewRecordCreditBatches({ ...f.ctx, organizationId: "" }, {
      kind: "application", deliveryId: randomUUID(), appliedWetMassKg: null, applicationId: null,
    })).rejects.toThrow("Unauthorized");
  }, TEST_TIMEOUT_MS);
});
