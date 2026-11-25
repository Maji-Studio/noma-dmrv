/** Real-DB segregation contracts. Run only against the disposable test database. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { binMovements, storageLocations } from "@/db/schema";
import { getEntities, getEntityById } from "@/data-access/entities";
import { createStorageLocationInTransaction, getStorageLocationWithFacility, updateStorageLocation } from "@/data-access/storage-locations";
import { validateProductionRunFeedstockDrawSources } from "@/data-access/production-runs/feedstock-draws";
import { createStorageLocation } from "@/lib/operations/storage-locations";
import { createQuickStorageLocation } from "@/lib/operations/quick-add";
import { logFeedstockDelivery, updateFeedstock } from "@/lib/operations/feedstocks";
import { runOperation } from "@/lib/operations/runner";
import { createFeedstockSchema } from "@/schemas/feedstocks";
import { listApiStorageLocations, findApiStorageLocation } from "@/data-access/api-storage-locations";
import { representStorageLocation } from "@/lib/representations/storage-locations";
import { UNCARBONIZED_INTAKE_MESSAGE, UNCARBONIZED_PRODUCTION_DRAW_MESSAGE } from "@/lib/uncarbonized-bins";
import { createIntakeFixture, removeIntakeFixture, type IntakeFixture } from "./helpers/operation-fixture";

const SUITE_TIMEOUT_MS = 30_000;
const STOCK_KG = 100;
let fixture: IntakeFixture;
let foreign: IntakeFixture;

beforeEach(async () => {
  fixture = await createIntakeFixture("uncarbonized");
  foreign = await createIntakeFixture("uncarbonized-foreign");
  await db.update(storageLocations).set({ feedstockTypeId: fixture.feedstockTypeId })
    .where(and(eq(storageLocations.organizationId, fixture.ctx.organizationId), eq(storageLocations.id, fixture.binId)));
}, SUITE_TIMEOUT_MS);
afterEach(async () => {
  if (fixture) {
    await db.delete(binMovements).where(eq(binMovements.organizationId, fixture.ctx.organizationId));
    await removeIntakeFixture(fixture);
  }
  if (foreign) await removeIntakeFixture(foreign);
}, SUITE_TIMEOUT_MS);

function binInput() {
  return { name: "Segregated material", type: "feedstock_bin" as const, facilityId: fixture.facilityId,
    feedstockTypeId: fixture.feedstockTypeId, uncarbonized: true };
}
function intake(binId = fixture.binId) {
  return createFeedstockSchema.parse({ ...fixture.input(STOCK_KG), allocations: [{ storageLocationId: binId, allocatedWetMassKg: STOCK_KG }] });
}
async function createTagged() {
  return (await runOperation(createStorageLocation, fixture.ctx, binInput())).data;
}
function lockedTagIssue() {
  return { code: "certification_locked", issues: [expect.objectContaining({ path: ["uncarbonized"], code: "certification_locked", message: expect.stringContaining("Uncarbonized") })] };
}

describe("uncarbonized storage identity", { timeout: SUITE_TIMEOUT_MS }, () => {
  it("persists the tag through full creation, quick-add, reads and partial updates", async () => {
    const bin = await createTagged();
    expect(bin.uncarbonized).toBe(true);
    expect(bin.feedstockTypeId).toBe(fixture.feedstockTypeId);
    expect((await getStorageLocationWithFacility(fixture.ctx, bin.id)).uncarbonized).toBe(true);
    const quick = await runOperation(createQuickStorageLocation, fixture.ctx, { ...binInput(), name: "Quick segregated material" });
    expect(quick.data.uncarbonized).toBe(true);
    expect((await getEntityById(fixture.ctx, "storageLocation", quick.data.id))?.uncarbonized).toBe(true);
    const cleared = await updateStorageLocation(fixture.ctx, bin.id, { expectedVersion: bin.version, uncarbonized: false });
    expect(cleared.uncarbonized).toBe(false);
    const retagged = await updateStorageLocation(fixture.ctx, bin.id, { expectedVersion: cleared.version, uncarbonized: true });
    expect(retagged.uncarbonized).toBe(true);
    const renamed = await updateStorageLocation(fixture.ctx, bin.id, { expectedVersion: retagged.version, name: "Renamed segregated material" });
    expect(renamed.uncarbonized).toBe(true);
  });

  it("defaults to false and clears the tag when an unused bin changes type", async () => {
    const [ordinary] = await db.select().from(storageLocations).where(and(eq(storageLocations.organizationId, fixture.ctx.organizationId), eq(storageLocations.id, fixture.binId)));
    expect(ordinary.uncarbonized).toBe(false);
    const bin = await createTagged();
    const changed = await updateStorageLocation(fixture.ctx, bin.id, { expectedVersion: bin.version, type: "biochar_bin" });
    expect(changed).toMatchObject({ type: "biochar_bin", uncarbonized: false, feedstockTypeId: null });
    await expect(updateStorageLocation(fixture.ctx, changed.id, { expectedVersion: changed.version, uncarbonized: true }))
      .rejects.toMatchObject({ code: "validation_failed", issues: [expect.objectContaining({ path: ["uncarbonized"] })] });
  });

  it.each(["biochar_bin", "product_bin"] as const)("enforces the DB check on %s inserts and type updates", async type => {
    await expect(db.insert(storageLocations).values({ organizationId: fixture.ctx.organizationId, facilityId: fixture.facilityId,
      code: `BAD-${type}`, name: `Bad ${type}`, type, uncarbonized: true })).rejects.toMatchObject({
      cause: { code: "23514", constraint: "storage_locations_uncarbonized_feedstock_bin_only" },
    });
    const bin = await createTagged();
    await expect(db.update(storageLocations).set({ type }).where(and(eq(storageLocations.organizationId, fixture.ctx.organizationId), eq(storageLocations.id, bin.id))))
      .rejects.toMatchObject({ cause: { code: "23514", constraint: "storage_locations_uncarbonized_feedstock_bin_only" } });
  });

  it("refuses direct creation of a tagged feedstock bin without its feedstock type", async () => {
    await expect(db.transaction(tx => createStorageLocationInTransaction(fixture.ctx, tx, {
      ...binInput(), feedstockTypeId: null, code: "MISSING-TYPE",
    }))).rejects.toThrow("Feedstock bins must be restricted to one feedstock type");
  });

  it("locks the tag after fresh intake while leaving ordinary metadata editable", async () => {
    await runOperation(logFeedstockDelivery, fixture.ctx, intake());
    await expect(updateStorageLocation(fixture.ctx, fixture.binId, { expectedVersion: 1, uncarbonized: true })).rejects.toMatchObject(lockedTagIssue());
    const renamed = await updateStorageLocation(fixture.ctx, fixture.binId, { expectedVersion: 1, name: "Fresh material" });
    expect(renamed).toMatchObject({ uncarbonized: false, name: "Fresh material" });
  });

  it.each([false, true])("locks both tag directions after stock history, starting tagged=%s", async uncarbonized => {
    const bin = await createTagged();
    const current = uncarbonized ? bin : await updateStorageLocation(fixture.ctx, bin.id, { expectedVersion: bin.version, uncarbonized: false });
    await db.insert(binMovements).values([STOCK_KG, -STOCK_KG].map(massDeltaKg => ({
      organizationId: fixture.ctx.organizationId, storageLocationId: bin.id, lane: "feedstock" as const,
      movementType: "adjustment" as const, massDeltaKg, reason: "Segregation history fixture",
    })));
    await expect(updateStorageLocation(fixture.ctx, bin.id, { expectedVersion: current.version, uncarbonized: !uncarbonized })).rejects.toMatchObject(lockedTagIssue());
  });
});

describe("uncarbonized segregation boundaries", { timeout: SUITE_TIMEOUT_MS }, () => {
  it("refuses fresh intake and delivery moves through the versioned operations, with bin-field issues", async () => {
    const tagged = await createTagged();
    await expect(runOperation(logFeedstockDelivery, fixture.ctx, intake(tagged.id))).rejects.toMatchObject({
      code: "validation_failed", message: UNCARBONIZED_INTAKE_MESSAGE,
      issues: [expect.objectContaining({ path: ["allocations", 0, "storageLocationId"] })],
    });
    const ordinary = await runOperation(logFeedstockDelivery, fixture.ctx, intake());
    expect(ordinary.data.feedstocks).toHaveLength(1);
    const saved = ordinary.data.feedstocks[0];
    await expect(runOperation(updateFeedstock, fixture.ctx, { feedstockId: saved.id, expectedVersion: saved.version, storageLocationId: tagged.id }))
      .rejects.toMatchObject({ code: "validation_failed", message: UNCARBONIZED_INTAKE_MESSAGE,
        issues: [expect.objectContaining({ path: ["storageLocationId"] })] });
  });

  it("refuses tagged production draw sources while accepting ordinary pyrolysis bins", async () => {
    const tagged = await createTagged();
    await db.transaction(async tx => {
      await expect(validateProductionRunFeedstockDrawSources(fixture.ctx, tx, [{ storageLocationId: tagged.id }], fixture.facilityId))
        .rejects.toMatchObject({ code: "validation_failed", message: UNCARBONIZED_PRODUCTION_DRAW_MESSAGE,
          issues: [expect.objectContaining({ path: ["feedstockDraws", 0, "storageLocationId"] })] });
      await expect(validateProductionRunFeedstockDrawSources(fixture.ctx, tx, [{ storageLocationId: fixture.binId }], fixture.facilityId)).resolves.toBeUndefined();
    });
  });

  it("parses false from EntitySelect filterBy and exposes the tag on list and detail options and REST rows", async () => {
    const tagged = await createTagged();
    const list = (uncarbonized?: string) => getEntities(fixture.ctx, { entityType: "storageLocation", filterBy: {
      facilityId: fixture.facilityId, ...(uncarbonized === undefined ? {} : { uncarbonized }),
    } });
    expect((await list()).map(row => row.id)).toEqual(expect.arrayContaining([tagged.id, fixture.binId]));
    expect((await list("false")).map(row => row.id)).toEqual([fixture.binId]);
    expect(await list("true")).toMatchObject([{ id: tagged.id, uncarbonized: true }]);
    expect(await list("invalid")).toEqual([]);
    expect(await getEntityById(fixture.ctx, "storageLocation", tagged.id)).toMatchObject({ uncarbonized: true });
    const apiRows = await listApiStorageLocations(fixture.ctx, { facilityId: fixture.facilityId, uncarbonized: false }, 10);
    expect(apiRows.map(row => row.id)).toEqual([fixture.binId]);
    expect(representStorageLocation(await findApiStorageLocation(fixture.ctx, { id: tagged.id })).uncarbonized).toBe(true);
  });

  it("does not reveal or use another organization's tagged bin", async () => {
    const tagged = await createTagged();
    expect(await getEntityById(foreign.ctx, "storageLocation", tagged.id)).toBeNull();
    expect(await getEntities(foreign.ctx, { entityType: "storageLocation", filterBy: { uncarbonized: "true" } })).toEqual([]);
    await expect(findApiStorageLocation(foreign.ctx, { id: tagged.id })).rejects.toMatchObject({ code: "not_found" });
    await expect(updateStorageLocation(foreign.ctx, tagged.id, { expectedVersion: tagged.version, uncarbonized: false })).rejects.toThrow("Storage bin was not found");
    await expect(runOperation(logFeedstockDelivery, foreign.ctx, createFeedstockSchema.parse({ ...foreign.input(STOCK_KG),
      allocations: [{ storageLocationId: tagged.id, allocatedWetMassKg: STOCK_KG }] }))).rejects.toMatchObject({ code: "not_found" });
    await expect(db.transaction(tx => validateProductionRunFeedstockDrawSources(foreign.ctx, tx, [{ storageLocationId: tagged.id }], foreign.facilityId)))
      .rejects.toMatchObject({ code: "not_found" });
  });
});
