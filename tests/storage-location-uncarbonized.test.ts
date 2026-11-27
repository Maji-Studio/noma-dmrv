/** Real Postgres contracts. Run after applying migration 0179; never executed by the implementation agent. */
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { storageLocations } from "@/db/schema";
import { createStorageLocationInTransaction, getStorageLocationWithFacility, getStorageLocations, updateStorageLocation } from "@/data-access/storage-locations";
import { createStorageLocation as quickAddBin } from "@/data-access/quick-add";
import { getEntities } from "@/data-access/entities";
import { getStorageLocations as pickerBins } from "@/data-access/entities/storage-locations";
import { getFacilityOutputStock } from "@/data-access/facility-output-stock";
import { prepareOutputStock, previewOutputStock } from "@/data-access/output-stock-operations";
import { previewProductStock } from "@/data-access/product-stock-preview";
import { createBiocharProductInTransaction } from "@/data-access/biochar-product-create";
import { createQuickStorageLocation } from "@/lib/operations/quick-add";
import { createStorageLocation } from "@/lib/operations/storage-locations";
import { recordOutputStockMovement } from "@/lib/operations/output-stock";
import { runOperation } from "@/lib/operations/runner";
import { UNCARBONIZED_BIOCHAR_BIN_MESSAGE, UNCARBONIZED_PRODUCT_SOURCE_MESSAGE } from "@/lib/storage-location-material";
import { cleanupOutputStockFixture } from "./helpers/output-stock-cleanup";
import { seedOutputStockParents } from "./helpers/output-stock-fixture";

const auth = vi.hoisted(() => ({ requireOrgContext: vi.fn() }));
vi.mock("@/lib/auth/server", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/auth/server")>(), requireOrgContext: auth.requireOrgContext,
}));
import { updateStorageLocationFn } from "@/fn/storage-locations";
import { searchEntitiesFn } from "@/fn/entities";

const TIMEOUT_MS = 60_000;
const AT = "2026-09-12T12:00:00.000Z";
const DRAW_WET_KG = 100;
const DRAW_MOISTURE_PERCENT = 10;
const SOURCE_DRY_KG = 1500;
const FIRST_RUN_WET_KG = 1000;
const FIRST_RUN_DRY_KG = 900;
const SECOND_RUN_WET_KG = 750;
const SECOND_RUN_DRY_KG = 600;
const SOURCE_WET_KG = FIRST_RUN_WET_KG + SECOND_RUN_WET_KG;
const fixtures: Awaited<ReturnType<typeof seedOutputStockParents>>[] = [];
async function fixture(uncarbonized = false) {
  const f = await seedOutputStockParents(db, { uncarbonized });
  fixtures.push(f);
  return f;
}
afterEach(async () => {
  for (const f of fixtures.splice(0)) await cleanupOutputStockFixture(db, f.ctx.organizationId);
}, TIMEOUT_MS);
const validation = (field: string, message: string) => ({ code: "validation_failed", issues: [{ path: [field], message }] });

async function unusedBin(f: Awaited<ReturnType<typeof fixture>>, uncarbonized = false) {
  return (await runOperation(createStorageLocation, f.ctx, {
    name: `E2E Unused ${randomUUID()}`, type: "biochar_bin", facilityId: f.facility.id, uncarbonized,
  })).data;
}

describe("uncarbonized storage bins", { timeout: TIMEOUT_MS }, () => {
  it.each(["feedstock_bin", "product_bin"] as const)("enforces the CHECK and field refusal for %s", async type => {
    const f = await fixture();
    const input = { code: `E2E-TAG-${randomUUID()}`, name: `E2E Tag ${randomUUID()}`, type, facilityId: f.facility.id,
      feedstockTypeId: type === "feedstock_bin" ? f.ingredientType.id : undefined, uncarbonized: true };
    await expect(db.insert(storageLocations).values({ ...input, organizationId: f.ctx.organizationId })).rejects.toMatchObject({
      cause: { code: "23514", constraint: "storage_locations_uncarbonized_biochar_bin_only" },
    });
    await expect(db.transaction(tx => createStorageLocationInTransaction(f.ctx, tx, input)))
      .rejects.toMatchObject(validation("uncarbonized", UNCARBONIZED_BIOCHAR_BIN_MESSAGE));
    await expect(quickAddBin(f.ctx, input)).rejects.toMatchObject(validation("uncarbonized", UNCARBONIZED_BIOCHAR_BIN_MESSAGE));
    const [ordinary] = await db.insert(storageLocations).values({ ...input, uncarbonized: false, organizationId: f.ctx.organizationId }).returning();
    // Payload omits type. The writer must validate against the effective row.
    await expect(updateStorageLocation(f.ctx, ordinary.id, { expectedVersion: ordinary.version, uncarbonized: true }))
      .rejects.toMatchObject(validation("uncarbonized", UNCARBONIZED_BIOCHAR_BIN_MESSAGE));
  });

  it("creates and quick-adds tagged biochar bins and permits edits before stock or history", async () => {
    const f = await fixture();
    const created = await unusedBin(f, true);
    expect(created.uncarbonized).toBe(true);
    const renamed = await updateStorageLocation(f.ctx, created.id, { expectedVersion: created.version, name: `E2E Renamed ${f.tag}` });
    expect(renamed.uncarbonized).toBe(true);
    const cleared = await updateStorageLocation(f.ctx, created.id, { expectedVersion: renamed.version, uncarbonized: false });
    expect(cleared.uncarbonized).toBe(false);
    auth.requireOrgContext.mockResolvedValue(f.ctx);
    const action = await updateStorageLocationFn({ storageLocationId: created.id, expectedVersion: cleared.version, uncarbonized: true });
    expect(action.success).toBe(true);
    if (!action.success) throw new Error(action.error);
    const retagged = action.data;
    expect(retagged.uncarbonized).toBe(true);
    expect((await getStorageLocationWithFacility(f.ctx, created.id)).uncarbonized).toBe(true);
    await expect(updateStorageLocation(f.ctx, created.id, { expectedVersion: retagged.version, type: "product_bin" }))
      .rejects.toMatchObject(validation("uncarbonized", UNCARBONIZED_BIOCHAR_BIN_MESSAGE));
    const quick = (await runOperation(createQuickStorageLocation, f.ctx, {
      name: `E2E Quick tag ${f.tag}`, type: "biochar_bin", facilityId: f.facility.id, uncarbonized: true,
    })).data;
    expect(quick.uncarbonized).toBe(true);
    expect(await getStorageLocationWithFacility(f.ctx, quick.id)).toMatchObject({ uncarbonized: true });
    expect((await unusedBin(f)).uncarbonized).toBe(false);
  });

  it.each([true, false])("locks changes away from tag %s with stock and after an empty count", async tag => {
    const f = await fixture(tag);
    const edit = () => updateStorageLocation(f.ctx, f.source.id, { expectedVersion: f.source.version, uncarbonized: !tag });
    await expect(edit()).rejects.toMatchObject({ code: "certification_locked", issues: [{ path: ["uncarbonized"] }] });
    // Counts stay available on tagged bins, and zero stock does not erase history.
    await runOperation(recordOutputStockMovement, f.ctx, {
      storageLocationId: f.source.id, kind: "count", occurredAt: AT, wetMassKg: 0, moisturePercent: 0, reason: "E2E empty count",
    });
    expect((await prepareOutputStock(f.ctx, { facilityId: f.facility.id, storageLocationId: f.source.id, kind: "count", occurredAt: AT, wetMassKg: 0 })).preview.beforeDryKg).toBe(0);
    await expect(edit()).rejects.toMatchObject({ code: "certification_locked", issues: [{ path: ["uncarbonized"] }] });
  });

  it("filters both picker tag values and exposes the tag in list and sheet reads", async () => {
    const f = await fixture();
    const tagged = await unusedBin(f, true);
    for (const tag of [true, false]) {
      const options = await pickerBins(f.ctx, { facilityId: f.facility.id, type: "biochar_bin", uncarbonized: tag, limit: 100 });
      expect(options.map(row => row.id)).toEqual([tag ? tagged.id : f.source.id]);
      expect(options[0].uncarbonized).toBe(tag);
      const dispatched = await getEntities(f.ctx, { entityType: "storageLocation", filterBy: {
        facilityId: f.facility.id, type: "biochar_bin", uncarbonized: String(tag),
      } });
      expect(dispatched.map(row => row.id)).toEqual(options.map(row => row.id));
      const list = await getStorageLocations(f.ctx, { facilityId: f.facility.id, type: "biochar_bin", uncarbonized: tag });
      expect(list.items.map(row => row.id)).toEqual(options.map(row => row.id));
      expect(list.items[0].uncarbonized).toBe(tag);
    }
    expect(await getStorageLocationWithFacility(f.ctx, tagged.id)).toMatchObject({ uncarbonized: true });
    auth.requireOrgContext.mockResolvedValue(f.ctx);
    const action = await searchEntitiesFn({ entityType: "storageLocation", filterBy: {
      facilityId: f.facility.id, type: "biochar_bin", uncarbonized: "false",
    } });
    expect(action.success).toBe(true);
    if (!action.success) throw new Error(action.error);
    expect(action.data.map(row => row.id)).toEqual([f.source.id]);
    const malformed = await searchEntitiesFn({ entityType: "storageLocation", filterBy: { uncarbonized: "yes" } });
    expect(malformed.success).toBe(false);
    const foreign = await fixture(true);
    expect((await pickerBins(f.ctx, { type: "biochar_bin", uncarbonized: true, limit: 100 })).map(row => row.id)).not.toContain(foreign.source.id);
  });

  it("refuses direct product create and both previews before allocating any tagged stock", async () => {
    const f = await fixture(true);
    const destination = (await runOperation(createStorageLocation, f.ctx, {
      name: `E2E Pure destination ${f.tag}`, type: "product_bin", facilityId: f.facility.id, formulationId: f.pure.id,
    })).data;
    const productInput = { facilityId: f.facility.id, formulationId: f.pure.id, placedAt: AT,
      sourceBiocharStorageLocationId: f.source.id, storageLocationId: destination.id,
      massKg: DRAW_WET_KG, moistureContentPercent: DRAW_MOISTURE_PERCENT, waterAddedKg: 0 };
    const error = validation("sourceBiocharStorageLocationId", UNCARBONIZED_PRODUCT_SOURCE_MESSAGE);
    await expect(db.transaction(tx => createBiocharProductInTransaction(f.ctx, tx, {
      ...productInput, code: `E2E-REFUSED-${f.tag}`, idempotencyKey: randomUUID(),
    }))).rejects.toMatchObject(error);
    await expect(previewProductStock(f.ctx, productInput)).rejects.toMatchObject(error);
    await expect(previewOutputStock(f.ctx, { facilityId: f.facility.id, storageLocationId: f.source.id,
      occurredAt: AT, kind: "production_draw", wetMassKg: DRAW_WET_KG, moisturePercent: DRAW_MOISTURE_PERCENT })).rejects.toMatchObject(error);
    const before = await getStorageLocationWithFacility(f.ctx, f.source.id);
    expect(before.biocharInventory.dryMassKg).toBe(SOURCE_DRY_KG);
    // A tagged bin can still record Lost mass.
    await runOperation(recordOutputStockMovement, f.ctx, { storageLocationId: f.source.id, occurredAt: AT,
      kind: "loss", wetMassKg: DRAW_WET_KG, moisturePercent: DRAW_MOISTURE_PERCENT, reason: "E2E Lost mass" });
    expect((await getStorageLocationWithFacility(f.ctx, f.source.id)).biocharInventory.dryMassKg).toBeLessThan(SOURCE_DRY_KG);
  });

  it("segregates facility totals and keeps individual tagged stock visible", async () => {
    const f = await fixture(true);
    const ordinary = await unusedBin(f);
    // Move the second lot to the ordinary bin with the matching Complete status.
    const { productionRuns } = await import("@/db/schema");
    await db.update(productionRuns).set({ biocharStorageLocationId: ordinary.id, status: "complete" })
      .where(and(eq(productionRuns.organizationId, f.ctx.organizationId), eq(productionRuns.id, f.runs[1].id)));
    const stock = await getFacilityOutputStock(f.ctx, f.facility.id);
    expect(stock).toMatchObject({ biochar: { wetKg: SECOND_RUN_WET_KG, dryBiocharKg: SECOND_RUN_DRY_KG }, uncarbonized: { wetKg: FIRST_RUN_WET_KG, dryBiocharKg: FIRST_RUN_DRY_KG } });
    const list = await getStorageLocations(f.ctx, { facilityId: f.facility.id });
    expect(list.laneSummary.biochar_bin).toMatchObject({ binCount: 2, onHandKg: SECOND_RUN_WET_KG, basis: "wet" });
    expect(list.items.find(row => row.id === f.source.id)).toMatchObject({ uncarbonized: true, biocharInventory: { currentMassKg: FIRST_RUN_WET_KG, dryMassKg: FIRST_RUN_DRY_KG } });
    expect(stock.biochar!.wetKg! + stock.uncarbonized!.wetKg!).toBe(SOURCE_WET_KG);
  });
});
