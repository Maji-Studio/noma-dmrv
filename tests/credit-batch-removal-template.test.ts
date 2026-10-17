import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, certifierProjects, creditBatches, facilities, feedstockTypes, productionProcesses } from "@/db/schema";
import { createCreditBatch, getCreditBatchProductionRunOptions, updateCreditBatch } from "@/data-access/credit-batches";
import { switchCreditBatchRemovalTemplate } from "@/data-access/credit-batch-removal-template";
import { withLineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID, TEST_SITE_POSITION } from "./helpers/test-org";

// DB-backed: needs supervisor after migration generation/application.
const ctx = makeTestOrgContext();
const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
let facilityId: string;
let feedstockTypeId: string;
const extraFacilityIds: string[] = [];
const scope = () => and(eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.facilityId, facilityId));
beforeAll(async () => {
  await ensureTestOrg();
  const [facility] = await db.insert(facilities).values({ ...TEST_SITE_POSITION, organizationId: TEST_ORG_ID, timezone: "UTC", code: `FAC-PIN-${tag}`, name: `Template pins ${tag}` }).returning();
  facilityId = facility.id;
  const [feedstockType] = await db.insert(feedstockTypes).values({ organizationId: TEST_ORG_ID, code: `FT-PIN-${tag}`, category: "forestry", name: `Template pins ${tag}`, usage: "pyrolysis" }).returning();
  feedstockTypeId = feedstockType.id;
});
afterAll(async () => {
  await db.delete(activityEvents).where(and(eq(activityEvents.organizationId, ctx.organizationId), eq(activityEvents.facilityId, facilityId)));
  await db.delete(creditBatches).where(scope());
  for (const id of extraFacilityIds) {
    await db.delete(activityEvents).where(and(eq(activityEvents.organizationId, ctx.organizationId), eq(activityEvents.facilityId, id)));
    await db.delete(creditBatches).where(and(eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.facilityId, id)));
    await db.delete(productionProcesses).where(and(eq(productionProcesses.organizationId, ctx.organizationId), eq(productionProcesses.facilityId, id)));
    await db.delete(certifierProjects).where(and(eq(certifierProjects.organizationId, ctx.organizationId), eq(certifierProjects.facilityId, id)));
    await db.delete(facilities).where(and(eq(facilities.organizationId, ctx.organizationId), eq(facilities.id, id)));
  }
  await db.delete(productionProcesses).where(and(eq(productionProcesses.organizationId, ctx.organizationId), eq(productionProcesses.facilityId, facilityId)));
  await db.delete(certifierProjects).where(and(eq(certifierProjects.organizationId, ctx.organizationId), eq(certifierProjects.facilityId, facilityId)));
  await db.delete(facilities).where(and(eq(facilities.organizationId, ctx.organizationId), eq(facilities.id, facilityId)));
  await db.delete(feedstockTypes).where(and(eq(feedstockTypes.organizationId, ctx.organizationId), eq(feedstockTypes.id, feedstockTypeId)));
});
function create(month: string) {
  return createCreditBatch(ctx, { facilityId, feedstockTypeId, code: `CB-PIN-${month}-${tag}`, sampling: "sampled", productionRunIds: [], startDate: new Date(`2026-${month}-01T00:00:00Z`), endDate: new Date(`2026-${month}-28T00:00:00Z`) });
}

describe("credit batch Removal template pins", () => {
  it("stays unpinned when the facility has no default", async () => {
    expect((await create("01")).removalTemplateId).toBeNull();
  });
  it("copies the facility default at creation and keeps existing pins", async () => {
    const [project] = await db.insert(certifierProjects).values({ organizationId: ctx.organizationId, facilityId, provider: "isometric", externalProjectId: "project-pins", externalFacilityId: "facility-pins", defaultRemovalTemplateId: "template-original" }).returning();
    const batch = await create("02");
    expect(batch.removalTemplateId).toBe("template-original");
    await db.update(certifierProjects).set({ defaultRemovalTemplateId: "template-next" }).where(and(eq(certifierProjects.organizationId, ctx.organizationId), eq(certifierProjects.id, project.id)));
    expect((await create("03")).removalTemplateId).toBe("template-next");
    const [stored] = await db.select().from(creditBatches).where(and(eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.id, batch.id)));
    expect(stored.removalTemplateId).toBe("template-original");
  });
  it("switches with version checking and one value-free activity event", async () => {
    const batch = await create("04");
    const updated = await switchCreditBatchRemovalTemplate(ctx, { creditBatchId: batch.id, removalTemplateId: "template-switched", expectedVersion: batch.version });
    expect(updated.version).toBe(batch.version + 1);
    const events = await db.select().from(activityEvents).where(and(eq(activityEvents.organizationId, ctx.organizationId), eq(activityEvents.entityId, batch.id), eq(activityEvents.action, "updated")));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ entityType: "credit_batch", changedFields: ["removalTemplateId"] });
    await expect(switchCreditBatchRemovalTemplate(ctx, { creditBatchId: batch.id, removalTemplateId: "template-stale", expectedVersion: batch.version })).rejects.toMatchObject({ code: "stale_version" });
  });
  it("refuses switches on a locked certified lineage", async () => {
    await withLineageFixture(async (fixture) => {
      const [batch] = await db.select().from(creditBatches).where(and(eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.id, fixture.batchId)));
      await expect(switchCreditBatchRemovalTemplate(ctx, { creditBatchId: batch.id, removalTemplateId: "template-new", expectedVersion: batch.version })).rejects.toThrow("locked by a certification submission");
    }, "removal");
  });
  describe("facility moves", () => {
    async function moveTarget(label: string, defaultTemplate: string | null) {
      const [facility] = await db.insert(facilities).values({ ...TEST_SITE_POSITION, organizationId: TEST_ORG_ID, timezone: "UTC", code: `FAC-MV-${label}-${tag}`, name: `Move ${label} ${tag}` }).returning();
      extraFacilityIds.push(facility.id);
      if (defaultTemplate) {
        await db.insert(certifierProjects).values({ organizationId: ctx.organizationId, facilityId: facility.id, provider: "isometric", externalProjectId: `project-mv-${label}-${tag}`, externalFacilityId: `facility-mv-${label}-${tag}`, defaultRemovalTemplateId: defaultTemplate });
      }
      return facility.id;
    }
    const pinOf = async (id: string) => (await db.select().from(creditBatches).where(and(eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.id, id))))[0];
    const updatedEvents = (id: string) => db.select().from(activityEvents).where(and(eq(activityEvents.organizationId, ctx.organizationId), eq(activityEvents.entityId, id), eq(activityEvents.action, "updated")));

    it("replaces the pin with the new facility default and records removalTemplateId", async () => {
      const batch = await create("05");
      await db.update(creditBatches).set({ removalTemplateId: "template-old-pin" }).where(and(eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.id, batch.id)));
      const target = await moveTarget("a", "template-target-default");
      await updateCreditBatch(ctx, batch.id, { facilityId: target, expectedVersion: (await pinOf(batch.id)).version });
      const stored = await pinOf(batch.id);
      expect(stored.facilityId).toBe(target);
      expect(stored.removalTemplateId).toBe("template-target-default");
      const events = await updatedEvents(batch.id);
      expect(events).toHaveLength(1);
      expect(events[0].changedFields).toEqual(expect.arrayContaining(["facilityId", "removalTemplateId"]));
    });
    it("clears the pin when the new facility has no default", async () => {
      const batch = await create("06");
      await db.update(creditBatches).set({ removalTemplateId: "template-old-pin" }).where(and(eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.id, batch.id)));
      const target = await moveTarget("b", null);
      await updateCreditBatch(ctx, batch.id, { facilityId: target, expectedVersion: (await pinOf(batch.id)).version });
      expect((await pinOf(batch.id)).removalTemplateId).toBeNull();
    });
    it("keeps the pin when the facility stays the same", async () => {
      const batch = await create("07");
      await db.update(creditBatches).set({ removalTemplateId: "template-kept-pin" }).where(and(eq(creditBatches.organizationId, ctx.organizationId), eq(creditBatches.id, batch.id)));
      await updateCreditBatch(ctx, batch.id, { facilityId, siteManagementNotes: "same facility", expectedVersion: (await pinOf(batch.id)).version });
      const stored = await pinOf(batch.id);
      expect(stored.removalTemplateId).toBe("template-kept-pin");
      expect(stored.siteManagementNotes).toBe("same facility");
      for (const event of await updatedEvents(batch.id)) expect(event.changedFields).not.toContain("removalTemplateId");
    });

    it("validates a changed period against the target facility's certifier in both directions", async () => {
      const startDate = new Date("2027-01-01");
      const shortEndDate = new Date("2027-01-31");
      const longEndDate = new Date("2027-04-30");
      const batch = await createCreditBatch(ctx, {
        facilityId, feedstockTypeId, code: `CB-MV-PERIOD-${tag}`,
        productionRunIds: [], startDate, endDate: shortEndDate,
      });
      expect(batch.certifier).toBe("isometric");
      const target = await moveTarget("period", null);

      const moved = await updateCreditBatch(ctx, batch.id, {
        facilityId: target, endDate: longEndDate, expectedVersion: batch.version,
      });
      expect(moved).toMatchObject({ facilityId: target, certifier: null, endDate: "2027-04-30" });

      await expect(updateCreditBatch(ctx, batch.id, {
        facilityId, expectedVersion: moved.version,
      })).rejects.toThrow("Choose an end date on or before 2027-01-31. Isometric credit batches must cover less than one month.");
      expect(await pinOf(batch.id)).toMatchObject({ facilityId: target, certifier: null, version: moved.version });

      const restored = await updateCreditBatch(ctx, batch.id, {
        facilityId, endDate: shortEndDate, expectedVersion: moved.version,
      });
      expect(restored).toMatchObject({ facilityId, certifier: "isometric", endDate: "2027-01-31" });
    });
  });

  it("keeps the Isometric month cap on create, update, and run options", async () => {
    const batch = await create("08");
    const period = { startDate: new Date("2026-09-01"), endDate: new Date("2026-12-31") };
    const message = "Choose an end date on or before 2026-09-30. Isometric credit batches must cover less than one month.";
    await expect(createCreditBatch(ctx, {
      facilityId, feedstockTypeId, code: `CB-PIN-POLICY-${tag}`, productionRunIds: [], ...period,
    })).rejects.toThrow(message);
    await expect(updateCreditBatch(ctx, batch.id, {
      expectedVersion: batch.version, ...period,
    })).rejects.toThrow(message);
    await expect(getCreditBatchProductionRunOptions(ctx, { facilityId, ...period })).rejects.toThrow(message);
  });
});
