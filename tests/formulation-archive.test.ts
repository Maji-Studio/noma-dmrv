import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
vi.hoisted(() => { process.env.DB_POOL_MAX = "1"; });
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, biocharProducts, feedstockTypes, orders, storageLocations } from "@/db/schema";
import { archiveFormulation, restoreFormulation, updateFormulation, deleteFormulation } from "@/lib/operations/formulations";
import { runOperation, runOperationInProcess } from "@/lib/operations/runner";
import { getFormulationById, getFormulations } from "@/data-access/formulations";
import { getFormulationsEntity, getFormulationEntityById } from "@/data-access/entities/formulations";
import { createStorageLocation, getStorageLocationWithFacility, updateStorageLocation } from "@/data-access/storage-locations";
import { getOutputBinAllLayersDryKg } from "@/data-access/output-stock";
import { createStorageLocation as quickAdd } from "@/data-access/quick-add";
import { makeBiocharProduct } from "@/lib/operations/biochar-products";
import { recordOrder, updateOrder } from "@/lib/operations/orders";
import { recordDelivery } from "@/lib/operations/deliveries";
import { recordApplication } from "@/lib/operations/applications";
import { createOrderFixture, cleanupOrderFixture, orderInput, type OrderFixture } from "./helpers/order-operation-fixture";

const TIMEOUT_MS = 60_000;
const SINGLE_CONNECTION = 1;
const fixtures: OrderFixture[] = [];
beforeAll(() => { expect(db.$client.options.max).toBe(SINGLE_CONNECTION); });
afterEach(async () => { for (const f of fixtures.splice(0)) await cleanupOrderFixture(f); });
async function fixture() { const f = await createOrderFixture(); fixtures.push(f); return f; }
const issue = (code: string, path = ["formulationId"]) => ({ code, issues: [expect.objectContaining({ path, code })] });

describe("formulation archive and restore", { timeout: TIMEOUT_MS }, () => {
  it("bumps the version and records one status transition for each command", async () => {
    const f = await fixture();
    const input = { formulationId: f.recipe.id, expectedVersion: 1 };
    const archived = await runOperationInProcess(archiveFormulation, f.ctx, input);
    expect(archived).toMatchObject({ version: 2, archivedAt: expect.any(Date) });
    expect(await getFormulationById(f.ctx, f.recipe.id)).toMatchObject({ version: 2, archivedAt: archived.archivedAt });
    await expect(runOperation(archiveFormulation, f.ctx, input)).rejects.toMatchObject({ code: "stale_version" });
    await expect(runOperation(archiveFormulation, f.ctx, { ...input, expectedVersion: 2 })).rejects.toMatchObject({
      ...issue("conflict"), message: `Formulation ${f.recipe.code} is already archived.`,
    });
    const restored = await runOperationInProcess(restoreFormulation, f.ctx, { ...input, expectedVersion: 2 });
    expect(restored).toMatchObject({ version: 3, archivedAt: null });
    await expect(runOperation(restoreFormulation, f.ctx, { ...input, expectedVersion: 2 })).rejects.toMatchObject({ code: "stale_version" });
    await expect(runOperation(restoreFormulation, f.ctx, { ...input, expectedVersion: 3 })).rejects.toMatchObject({
      ...issue("conflict"), message: `Formulation ${f.recipe.code} is not archived.`,
    });
    const events = await db.select().from(activityEvents).where(eq(activityEvents.entityId, f.recipe.id)).orderBy(activityEvents.sequence);
    expect(events).toMatchObject([
      { action: "status_changed", fromStatus: "active", toStatus: "archived", changedFields: [], versionBefore: 1, versionAfter: 2 },
      { action: "status_changed", fromStatus: "archived", toStatus: "active", changedFields: [], versionBefore: 2, versionAfter: 3 },
    ]);
  });

  it("replays a keyed archive after restore without touching the restored row or Activity", async () => {
    const f = await fixture();
    const input = { formulationId: f.recipe.id, expectedVersion: 1 };
    const options = { idempotency: { credentialId: "formulation-archive-test", key: crypto.randomUUID() } };
    const first = await runOperation(archiveFormulation, f.ctx, input, options);
    await runOperation(restoreFormulation, f.ctx, { ...input, expectedVersion: 2 });
    await expect(runOperation(archiveFormulation, f.ctx, input, options)).resolves.toMatchObject({ replayed: true, data: first.data, effect: first.effect });
    expect(await getFormulationById(f.ctx, f.recipe.id)).toMatchObject({ version: 3, archivedAt: null });
    expect(await db.select().from(activityEvents).where(eq(activityEvents.entityId, f.recipe.id))).toHaveLength(2);
  });

  it("rolls back the row, version and Activity on both dry-run transitions", async () => {
    const f = await fixture();
    const input = { formulationId: f.recipe.id, expectedVersion: 1 };
    await expect(runOperation(archiveFormulation, f.ctx, input, { dryRun: true })).resolves.toMatchObject({ dryRun: true, data: { version: 2, archivedAt: expect.any(String) } });
    expect(await getFormulationById(f.ctx, f.recipe.id)).toMatchObject({ version: 1, archivedAt: null });
    expect(await db.select().from(activityEvents).where(eq(activityEvents.entityId, f.recipe.id))).toEqual([]);
    const archived = await runOperationInProcess(archiveFormulation, f.ctx, input);
    await runOperation(restoreFormulation, f.ctx, { ...input, expectedVersion: 2 }, { dryRun: true });
    expect(await getFormulationById(f.ctx, f.recipe.id)).toMatchObject({ version: 2, archivedAt: archived.archivedAt });
    expect(await db.select().from(activityEvents).where(eq(activityEvents.entityId, f.recipe.id))).toHaveLength(1);
  });

  it("refuses archived PATCH before stale and current versions, while delete remains guarded by use", async () => {
    const f = await fixture();
    await runOperation(archiveFormulation, f.ctx, { formulationId: f.recipe.id, expectedVersion: 1 });
    for (const expectedVersion of [1, 2]) {
      await expect(runOperation(updateFormulation, f.ctx, { formulationId: f.recipe.id, expectedVersion, name: "No edit" })).rejects.toMatchObject({
        ...issue("not_found"), message: `Formulation ${f.recipe.code} is archived. Restore it before editing it.`,
      });
    }
    await expect(runOperation(deleteFormulation, f.ctx, { formulationId: f.recipe.id, expectedVersion: 2 })).rejects.toMatchObject(issue("conflict"));
    await runOperation(archiveFormulation, f.ctx, { formulationId: f.pure.id, expectedVersion: 1 });
    await expect(runOperation(deleteFormulation, f.ctx, { formulationId: f.pure.id, expectedVersion: 2 })).resolves.toMatchObject({ data: null });
  });

  it("answers the same 404 for foreign and missing command targets", async () => {
    const f = await fixture(); const foreign = await fixture();
    for (const operation of [archiveFormulation, restoreFormulation]) {
      for (const formulationId of [crypto.randomUUID(), foreign.recipe.id]) {
        await expect(runOperation(operation, f.ctx, { formulationId, expectedVersion: 1 })).rejects.toMatchObject(issue("not_found"));
      }
    }
    expect(await getFormulationById(foreign.ctx, foreign.recipe.id)).toMatchObject({ version: 1, archivedAt: null });
  });

  it("restores without checking retained archived feedstock types", async () => {
    const f = await fixture();
    await runOperation(archiveFormulation, f.ctx, { formulationId: f.recipe.id, expectedVersion: 1 });
    await db.update(feedstockTypes).set({ archivedAt: new Date() }).where(eq(feedstockTypes.id, f.ingredientType.id));
    await expect(runOperation(restoreFormulation, f.ctx, { formulationId: f.recipe.id, expectedVersion: 2 }))
      .resolves.toMatchObject({ data: { archivedAt: null, ingredients: [expect.objectContaining({ feedstockTypeId: f.ingredientType.id })] } });
  });

  it("refuses every new reference at the formulation pointer", async () => {
    const f = await fixture();
    const order = (await runOperation(recordOrder, f.ctx, orderInput(f))).data;
    await runOperation(archiveFormulation, f.ctx, { formulationId: f.pure.id, expectedVersion: 1 });
    const bin = { facilityId: f.facility.id, formulationId: f.pure.id, code: "BIN-NEW", name: "New product bin", type: "product_bin" as const };
    const calls = [
      () => runOperation(makeBiocharProduct, f.ctx, { facilityId: f.facility.id, formulationId: f.pure.id, placedAt: "2026-09-12T12:00:00Z",
        sourceBiocharStorageLocationId: f.source.id, storageLocationId: f.bin.id, biocharWetMassKg: 100, biocharMoisturePercent: 10, waterAddedKg: 0, ingredients: [] }),
      () => runOperation(recordOrder, f.ctx, { ...orderInput(f), formulationId: f.pure.id }),
      () => runOperation(updateOrder, f.ctx, { orderId: order.id, expectedVersion: order.version, formulationId: f.pure.id }),
      () => createStorageLocation(f.ctx, bin),
      () => quickAdd(f.ctx, bin),
      () => updateStorageLocation(f.ctx, f.bin.id, { expectedVersion: f.bin.version, formulationId: f.pure.id }),
    ];
    for (const call of calls) {
      await expect(call()).rejects.toMatchObject({ ...issue("not_found"),
        message: `Formulation ${f.pure.code} is archived. Restore it or choose another formulation.`,
      });
    }
  });

  it("keeps omitted and echoed order and bin references editable after archive", async () => {
    const f = await fixture();
    const order = (await runOperation(recordOrder, f.ctx, orderInput(f))).data;
    await runOperation(archiveFormulation, f.ctx, { formulationId: f.recipe.id, expectedVersion: 1 });
    await expect(runOperation(updateOrder, f.ctx, { orderId: order.id, expectedVersion: order.version, quantityKg: 200 }))
      .resolves.toMatchObject({ data: { formulationId: f.recipe.id, quantityKg: 200, version: 2 } });
    await expect(runOperation(updateOrder, f.ctx, { orderId: order.id, expectedVersion: 2, formulationId: f.recipe.id, quantityKg: 300 }))
      .resolves.toMatchObject({ data: { formulationId: f.recipe.id, quantityKg: 300, version: 3 } });
    const renamed = await updateStorageLocation(f.ctx, f.bin.id, { expectedVersion: f.bin.version, name: "Renamed bin" });
    expect(renamed.formulationId).toBe(f.recipe.id);
    await expect(updateStorageLocation(f.ctx, f.bin.id, { expectedVersion: renamed.version, formulationId: f.recipe.id, name: "Echoed bin" }))
      .resolves.toMatchObject({ formulationId: f.recipe.id, name: "Echoed bin" });
  });

  it("allows clearing an archived formulation from an empty product bin", async () => {
    const f = await fixture();
    await runOperation(archiveFormulation, f.ctx, { formulationId: f.recipe.id, expectedVersion: f.recipe.version });
    await expect(updateStorageLocation(f.ctx, f.bin.id, { expectedVersion: f.bin.version, formulationId: null }))
      .resolves.toMatchObject({ formulationId: null, version: 2 });
    expect(await getStorageLocationWithFacility(f.ctx, f.bin.id)).toMatchObject({ formulationId: null, version: 2 });
  });

  it("refuses assigning an archived formulation to an unclaimed product bin", async () => {
    const f = await fixture();
    const bin = await createStorageLocation(f.ctx, {
      facilityId: f.facility.id, code: `E2E-UNCLAIMED-${f.tag}`, name: `E2E Unclaimed bin ${f.tag}`, type: "product_bin",
    });
    await runOperation(archiveFormulation, f.ctx, { formulationId: f.pure.id, expectedVersion: f.pure.version });
    await expect(updateStorageLocation(f.ctx, bin.id, { expectedVersion: bin.version, formulationId: f.pure.id }))
      .rejects.toMatchObject({ ...issue("not_found"), message: `Formulation ${f.pure.code} is archived. Restore it or choose another formulation.` });
    expect(await getStorageLocationWithFacility(f.ctx, bin.id)).toMatchObject({ formulationId: null, version: bin.version });
  });

  it("refuses a product using an archived formulation without claiming an unclaimed bin or drawing stock", async () => {
    const f = await fixture();
    const bin = await createStorageLocation(f.ctx, {
      facilityId: f.facility.id, code: `E2E-UNCLAIMED-${f.tag}`, name: `E2E Unclaimed bin ${f.tag}`, type: "product_bin",
    });
    const sourceStock = await getOutputBinAllLayersDryKg(f.ctx, f.source.id);
    await runOperation(archiveFormulation, f.ctx, { formulationId: f.pure.id, expectedVersion: f.pure.version });
    await expect(runOperation(makeBiocharProduct, f.ctx, {
      facilityId: f.facility.id, formulationId: f.pure.id, placedAt: "2026-09-12T12:00:00Z",
      sourceBiocharStorageLocationId: f.source.id, storageLocationId: bin.id,
      biocharWetMassKg: 100, biocharMoisturePercent: 10, waterAddedKg: 0, ingredients: [],
    })).rejects.toMatchObject({ ...issue("not_found"), message: `Formulation ${f.pure.code} is archived. Restore it or choose another formulation.` });
    expect(await getStorageLocationWithFacility(f.ctx, bin.id)).toMatchObject({ formulationId: null, version: bin.version });
    expect(await getOutputBinAllLayersDryKg(f.ctx, bin.id)).toBe(0);
    expect(await getOutputBinAllLayersDryKg(f.ctx, f.source.id)).toBe(sourceStock);
    expect(await db.select().from(biocharProducts).where(eq(biocharProducts.organizationId, f.ctx.organizationId))).toEqual([]);
  });

  it("still refuses deleting an archived formulation used only by an archived order", async () => {
    const f = await fixture();
    const order = (await runOperation(recordOrder, f.ctx, { ...orderInput(f), formulationId: f.pure.id })).data;
    await db.update(orders).set({ archivedAt: new Date() }).where(eq(orders.id, order.id));
    await runOperation(archiveFormulation, f.ctx, { formulationId: f.pure.id, expectedVersion: 1 });
    await expect(runOperation(deleteFormulation, f.ctx, { formulationId: f.pure.id, expectedVersion: 2 })).rejects.toMatchObject(issue("conflict"));
  });

  it("allows deliveries and applications to finish an existing order after formulation archive", async () => {
    const f = await fixture();
    await db.update(storageLocations).set({ stockMode: "mix" }).where(eq(storageLocations.id, f.bin.id));
    await runOperation(makeBiocharProduct, f.ctx, {
      facilityId: f.facility.id, formulationId: f.recipe.id, placedAt: "2026-09-12T12:00:00Z",
      sourceBiocharStorageLocationId: f.source.id, storageLocationId: f.bin.id,
      biocharWetMassKg: 100, biocharMoisturePercent: 10, waterAddedKg: 0,
      ingredients: [{ formulationIngredientId: f.ingredient.id, storageLocationId: null, wetMassKg: 20, moisturePercent: 0 }],
    });
    const order = (await runOperation(recordOrder, f.ctx, orderInput(f))).data;
    await runOperation(archiveFormulation, f.ctx, { formulationId: f.recipe.id, expectedVersion: 1 });
    const delivery = (await runOperation(recordDelivery, f.ctx, {
      orderId: order.id, storageLocationId: f.bin.id, deliveredAt: "2026-09-14T12:00:00Z", deliveredWetMassKg: 20, moisturePercent: 20,
    })).data.delivery;
    expect(delivery).toMatchObject({ orderId: order.id, deliveredWetMassKg: 20 });
    const application = (await runOperation(recordApplication, f.ctx, {
      deliveryId: delivery.id, applicationDate: "2026-09-15", appliedWetMassKg: 10, fieldSizeHa: 1,
      gpsLatitude: f.location.gpsLatitude, gpsLongitude: f.location.gpsLongitude, soilTemperatureC: null,
    })).data.application;
    expect(application).toMatchObject({ deliveryId: delivery.id, biocharAppliedTons: 0.01 });
    expect(await getFormulationById(f.ctx, f.recipe.id)).toMatchObject({ archivedAt: expect.any(Date), version: 2 });
  });

  it("replays an existing product after archive through both runner and posting keys", async () => {
    const f = await fixture();
    const input = {
      facilityId: f.facility.id, formulationId: f.recipe.id, placedAt: "2026-09-12T12:00:00Z",
      sourceBiocharStorageLocationId: f.source.id, storageLocationId: f.bin.id,
      biocharWetMassKg: 100, biocharMoisturePercent: 10, waterAddedKg: 0, idempotencyKey: crypto.randomUUID(),
      ingredients: [{ formulationIngredientId: f.ingredient.id, storageLocationId: null, wetMassKg: 0 }],
    };
    const options = { idempotency: { credentialId: "formulation-product-test", key: crypto.randomUUID() } };
    const first = await runOperation(makeBiocharProduct, f.ctx, input, options);
    await runOperation(archiveFormulation, f.ctx, { formulationId: f.recipe.id, expectedVersion: 1 });
    await expect(runOperation(makeBiocharProduct, f.ctx, input, options)).resolves.toMatchObject({ replayed: true, data: first.data });
    await expect(runOperation(makeBiocharProduct, f.ctx, input)).resolves.toMatchObject({ data: { product: { id: first.data.product.id } } });
    expect(await db.select().from(activityEvents).where(eq(activityEvents.entityId, first.data.product.id))).toHaveLength(1);
    await expect(runOperation(deleteFormulation, f.ctx, { formulationId: f.recipe.id, expectedVersion: 2 })).rejects.toMatchObject({
      ...issue("conflict"), message: "Formulation was not deleted because biochar products use it. Keep this formulation.",
    });
  });

  it("hides archived picker choices, marks by-id choices and filters app lists", async () => {
    const f = await fixture();
    await runOperation(archiveFormulation, f.ctx, { formulationId: f.recipe.id, expectedVersion: 1 });
    expect(await getFormulationsEntity(f.ctx, { search: f.recipe.code, limit: 10 })).toEqual([]);
    expect(await getFormulationEntityById(f.ctx, f.recipe.id)).toMatchObject({ id: f.recipe.id, subtitle: "Archived" });
    expect(await getFormulations(f.ctx)).toMatchObject({ total: 1, items: [expect.objectContaining({ id: f.pure.id })] });
    expect(await getFormulations(f.ctx, { archived: true })).toMatchObject({ total: 1, items: [expect.objectContaining({ id: f.recipe.id })] });
    const foreign = await fixture();
    expect(await getFormulationEntityById(foreign.ctx, f.recipe.id)).toBeNull();
    expect(await getFormulations(foreign.ctx, { archived: true })).toMatchObject({ total: 0, items: [] });
  });
});
