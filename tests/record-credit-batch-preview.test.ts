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
  creditBatchApplications, creditBatchProductionRuns, creditBatches, deliveries, feedstockTypes, productionProcesses, storageLocations,
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
/** Before run 2 ends, so only run 1 is in the bin. */
const RUN_ONE_ONLY_AT = "2026-09-10T12:00:00.000Z";
/** 1000 kg of run 1 at this reading leaves 0.1 g of solids: a residual with no dry gram left. */
const RESIDUAL_MOISTURE = 10.00001;
const RUN_ONE_BLEND_KG = 1200;
const AFTER_RESIDUAL_BLEND_KG = 300;
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

function productInput(f: Fixture, blendKg: number, placedAt: string, moisture: number) {
  const composition = { ingredients: [{ formulationIngredientId: f.ingredient.id, feedstockTypeId: f.ingredientType.id, massKg: INGREDIENT_KG, moistureContentPercent: 60 }] };
  const sourceWetKg = deriveCompositionSourceBiocharMassKg(blendKg, composition);
  if (sourceWetKg == null) throw new Error("Fixture blend has no source biochar");
  return {
    sourceWetKg,
    data: {
      code: `E2E-PREVIEW-P-${randomUUID().slice(0, 6).toUpperCase()}`, facilityId: f.facility.id, formulationId: f.recipe.id, placedAt,
      sourceBiocharStorageLocationId: f.source.id, storageLocationId: f.bin.id,
      massKg: blendKg, moistureContentPercent: moisture, waterAddedKg: 0, idempotencyKey: randomUUID(), composition,
    },
  };
}

/** Previews a product draw, saves it, and reads the saved line back. */
async function previewThenSaveProduct(f: Fixture, blendKg: number, placedAt: string, moisture = MOISTURE) {
  const { sourceWetKg, data } = productInput(f, blendKg, placedAt, moisture);
  const preview = await previewRecordCreditBatches(f.ctx, {
    kind: "biochar-product", bin: { storageLocationId: f.source.id, facilityId: f.facility.id, occurredAt: placedAt },
    draw: { wetMassKg: sourceWetKg, moisturePercent: moisture },
  });
  const product = await createBiocharProduct(f.ctx, await withProductStockFingerprint(f.ctx, data));
  const saved = await getRecordCreditBatches(f.ctx, { kind: "biochar-product", id: product.id });
  return { preview, saved, product };
}

/** Previews a delivery from the product bin, saves it through the runner, and reads the saved line back. */
async function previewThenSaveDelivery(f: Fixture) {
  const order = await runOperationInProcess(recordOrder, f.ctx, {
    facilityId: f.facility.id, customerId: f.customer.id, customerLocationId: f.location.id,
    formulationId: f.recipe.id, orderDate: "2026-09-12", quantityKg: 2000, packaging: "loose",
  });
  const bin = { storageLocationId: f.bin.id, facilityId: f.facility.id, occurredAt: DELIVERED_AT };
  const draw = { wetMassKg: DELIVERY_WET_KG, moisturePercent: DELIVERY_MOISTURE };
  const binOnly = await previewRecordCreditBatches(f.ctx, { kind: "delivery", bin, draw: null });
  const preview = await previewRecordCreditBatches(f.ctx, { kind: "delivery", bin, draw });
  const stock = await previewOutputStock(f.ctx, { ...bin, kind: "delivery", ...draw });
  const delivery = await createDelivery(f.ctx, {
    code: `E2E-PREVIEW-D-${randomUUID().slice(0, 6).toUpperCase()}`, orderId: order.id, facilityId: f.facility.id,
    deliveryDate: new Date(DELIVERED_AT), storageLocationId: f.bin.id,
    deliveredWetMassKg: DELIVERY_WET_KG, moistureContentPercent: DELIVERY_MOISTURE,
    idempotencyKey: randomUUID(), basisFingerprint: stock.basisFingerprint,
  });
  const saved = await getRecordCreditBatches(f.ctx, { kind: "delivery", id: delivery.id });
  return { binOnly, preview, saved, delivery };
}

/** Previews an application, saves it, and reads the saved line back. */
async function previewThenSaveApplication(f: Fixture, deliveryId: string) {
  const preview = await previewRecordCreditBatches(f.ctx, { kind: "application", deliveryId, appliedWetMassKg: APPLIED_KG, applicationId: null });
  const application = await createTestApplication(f.ctx, {
    code: `E2E-PREVIEW-A-${randomUUID().slice(0, 6).toUpperCase()}`, deliveryId, applicationDate: new Date(DELIVERED_AT),
    appliedWetMassKg: APPLIED_KG, fieldSizeHa: 1,
  });
  const saved = await getRecordCreditBatches(f.ctx, { kind: "application", id: application.id });
  return { preview, saved };
}

describe("credit batch preview agrees with the save (real database)", () => {
  it("previews a product draw, a delivery and an application exactly as saving assigns them", async () => {
    const f = await fixture();

    // Before the mass is known, the bin holds both runs, so either batch is possible.
    const binOnly = await previewRecordCreditBatches(f.ctx, {
      kind: "biochar-product", bin: { storageLocationId: f.source.id, facilityId: f.facility.id, occurredAt: PLACED_AT }, draw: null,
    });
    expect(binOnly).toMatchObject({ basis: "source", heldOut: false, sourceRunCount: 2, unbatchedRunCount: 0 });
    expect(ids(binOnly.batches)).toEqual([f.early.id, f.late.id]);

    // Oldest first: a small draw stays inside run 1.
    const small = await previewThenSaveProduct(f, SMALL_BLEND_KG, PLACED_AT);
    expect(small.preview.basis).toBe("planned");
    expect(ids(small.preview.batches)).toEqual([f.early.id]);
    expect(small.saved).toEqual({ batches: small.preview.batches, heldOut: false });

    // A larger draw empties run 1 and reaches run 2.
    const large = await previewThenSaveProduct(f, LARGE_BLEND_KG, SECOND_PLACED_AT);
    expect(ids(large.preview.batches)).toEqual([f.early.id, f.late.id]);
    expect(large.saved).toEqual({ batches: large.preview.batches, heldOut: false });

    // A delivery draws the oldest product first, which holds run 1 only.
    const delivery = await previewThenSaveDelivery(f);
    expect(delivery.binOnly.basis).toBe("source");
    expect(ids(delivery.binOnly.batches)).toEqual([f.early.id, f.late.id]);
    expect(delivery.preview.basis).toBe("planned");
    expect(ids(delivery.preview.batches)).toEqual([f.early.id]);
    expect(delivery.saved).toEqual({ batches: delivery.preview.batches, heldOut: false });

    // An application takes proportional shares of the saved truck.
    const before = await previewRecordCreditBatches(f.ctx, { kind: "application", deliveryId: delivery.delivery.id, appliedWetMassKg: null, applicationId: null });
    expect(before).toMatchObject({ basis: "source", heldOut: false });
    expect(ids(before.batches)).toEqual([f.early.id]);
    const application = await previewThenSaveApplication(f, delivery.delivery.id);
    expect(application.preview.basis).toBe("planned");
    expect(application.saved).toEqual({ batches: application.preview.batches, heldOut: false });

    // An amount the save would refuse names no batch.
    const tooMuch = await previewRecordCreditBatches(f.ctx, {
      kind: "application", deliveryId: delivery.delivery.id, appliedWetMassKg: DELIVERY_WET_KG * 2, applicationId: null,
    });
    expect(tooMuch).toEqual({ batches: [], heldOut: false, basis: "refused", sourceRunCount: 0, unbatchedRunCount: 0 });
  }, TEST_TIMEOUT_MS);

  it("keeps a run whose residual layer gives a product no dry gram, as the saved product line does", async () => {
    const f = await fixture();
    // Run 1 alone, drawn down to 0.1 g of solids: no dry gram left, but still a layer.
    await previewThenSaveProduct(f, RUN_ONE_BLEND_KG, RUN_ONE_ONLY_AT, RESIDUAL_MOISTURE);
    // The next product empties run 1's residual first, then draws run 2.
    const next = await previewThenSaveProduct(f, AFTER_RESIDUAL_BLEND_KG, SECOND_PLACED_AT);
    expect(next.saved).toEqual({ batches: next.preview.batches, heldOut: false });
    expect(ids(next.saved.batches)).toEqual([f.early.id, f.late.id]);
  }, TEST_TIMEOUT_MS);

  it("holds out an application from a mix bin, as the saved line does", async () => {
    const f = await fixture();
    // A bin that starts as a mix bin draws pro rata from the first removal on.
    await db.update(storageLocations).set({ stockMode: "mix" }).where(and(
      eq(storageLocations.organizationId, f.ctx.organizationId), eq(storageLocations.id, f.bin.id)));
    await previewThenSaveProduct(f, SMALL_BLEND_KG, PLACED_AT);
    const { delivery } = await previewThenSaveDelivery(f);
    const before = await previewRecordCreditBatches(f.ctx, { kind: "application", deliveryId: delivery.id, appliedWetMassKg: null, applicationId: null });
    expect(before).toMatchObject({ batches: [], heldOut: true, basis: "source" });
    const application = await previewThenSaveApplication(f, delivery.id);
    expect(application.preview).toMatchObject({ batches: [], heldOut: true, basis: "planned" });
    expect(application.saved).toEqual({ batches: [], heldOut: true });
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
    expect(binOnly).toMatchObject({ basis: "source", sourceRunCount: 2, unbatchedRunCount: 1 });
    expect(ids(binOnly.batches)).toEqual([f.early.id]);

    await db.delete(creditBatchProductionRuns).where(eq(creditBatchProductionRuns.organizationId, f.ctx.organizationId));
    const { preview, saved } = await previewThenSaveProduct(f, SMALL_BLEND_KG, PLACED_AT);
    expect(preview).toMatchObject({ batches: [], basis: "planned", unbatchedRunCount: 1 });
    expect(saved).toEqual({ batches: [], heldOut: false });
  }, TEST_TIMEOUT_MS);

  it("names no batch for a refused draw, and none for an empty bin", async () => {
    const f = await fixture();
    const bin = { storageLocationId: f.source.id, facilityId: f.facility.id };
    const overDraw = await previewRecordCreditBatches(f.ctx, {
      kind: "biochar-product", bin: { ...bin, occurredAt: PLACED_AT }, draw: { wetMassKg: 100_000, moisturePercent: MOISTURE },
    });
    expect(overDraw).toEqual({ batches: [], heldOut: false, basis: "refused", sourceRunCount: 0, unbatchedRunCount: 0 });
    // Before either run ended, the bin holds nothing.
    const empty = await previewRecordCreditBatches(f.ctx, {
      kind: "biochar-product", bin: { ...bin, occurredAt: "2026-09-01T00:00:00.000Z" }, draw: null,
    });
    expect(empty).toMatchObject({ batches: [], basis: "source", sourceRunCount: 0 });
  }, TEST_TIMEOUT_MS);

  it("says untraceable, not empty, for a delivery whose saved allocation does not balance", async () => {
    const f = await fixture();
    await previewThenSaveProduct(f, SMALL_BLEND_KG, PLACED_AT);
    const { delivery } = await previewThenSaveDelivery(f);
    await db.update(deliveries).set({ massDryKg: Number(delivery.massDryKg) + 1 }).where(eq(deliveries.id, delivery.id));
    for (const appliedWetMassKg of [null, APPLIED_KG]) {
      expect(await previewRecordCreditBatches(f.ctx, { kind: "application", deliveryId: delivery.id, appliedWetMassKg, applicationId: null }))
        .toEqual({ batches: [], heldOut: false, basis: "untraceable", sourceRunCount: 0, unbatchedRunCount: 0 });
    }
  }, TEST_TIMEOUT_MS);

  it("hides another organization's bin and saved delivery", async () => {
    const f = await fixture();
    await previewThenSaveProduct(f, SMALL_BLEND_KG, PLACED_AT);
    const { delivery } = await previewThenSaveDelivery(f);
    const other = { ...f.ctx, organizationId: `e2e-other-${randomUUID()}` };
    await expect(previewRecordCreditBatches(other, {
      kind: "delivery", bin: { storageLocationId: f.bin.id, facilityId: f.facility.id, occurredAt: DELIVERED_AT }, draw: null,
    })).rejects.toThrow(/not found/i);
    await expect(previewRecordCreditBatches(other, {
      kind: "application", deliveryId: delivery.id, appliedWetMassKg: null, applicationId: null,
    })).rejects.toThrow(/not found/i);
    await expect(previewRecordCreditBatches({ ...f.ctx, organizationId: "" }, {
      kind: "application", deliveryId: delivery.id, appliedWetMassKg: null, applicationId: null,
    })).rejects.toThrow("Unauthorized");
  }, TEST_TIMEOUT_MS);
});
