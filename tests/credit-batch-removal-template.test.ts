import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, certifierProjects, creditBatches, facilities, feedstockTypes, productionProcesses } from "@/db/schema";
import { createCreditBatch } from "@/data-access/credit-batches";
import { switchCreditBatchRemovalTemplate } from "@/data-access/credit-batch-removal-template";
import { withLineageFixture } from "./helpers/certification-lineage-fixture";
import { ensureTestOrg, makeTestOrgContext, TEST_ORG_ID, TEST_SITE_POSITION } from "./helpers/test-org";

// DB-backed: needs supervisor after migration generation/application.
const ctx = makeTestOrgContext();
const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
let facilityId: string;
let feedstockTypeId: string;
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
});
