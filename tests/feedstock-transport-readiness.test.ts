import { feedstockFixtureValues, cleanupFeedstockFixtureParents } from "./helpers/feedstock-fixture";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { facilities, feedstocks, feedstockTypes, transportLegs } from "@/db/schema";
import { getFeedstockById, getFeedstocks } from "@/data-access/feedstocks";
import { withFeedstockTransportReadiness } from "@/data-access/feedstock-transport-readiness";
import { deriveEntityCertifyReadiness } from "@/lib/certification/entity-readiness";
import { TEST_SITE_POSITION, ensureTestOrg, makeTestOrgContext, TEST_ORG_ID } from "./helpers/test-org";

beforeAll(() => ensureTestOrg());

describe("feedstock transport readiness scoping", () => {
  it("loads manual legs for detail and list, without accepting another organization's leg", async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    const ctx = makeTestOrgContext();
    const [facility] = await db.insert(facilities).values({ ...TEST_SITE_POSITION, organizationId: TEST_ORG_ID, code: `FR-F-${tag}`, name: `Feedstock readiness ${tag}`, timezone: "UTC" }).returning();
    const [type] = await db.insert(feedstockTypes).values({ organizationId: TEST_ORG_ID, code: `FR-T-${tag}`, name: `Feedstock readiness ${tag}`, category: "forestry" }).returning();
    const [stock] = await db.insert(feedstocks).values(await feedstockFixtureValues(db, { organizationId: TEST_ORG_ID, facilityId: facility.id, feedstockTypeId: type.id, code: `FR-${tag}`, status: "complete", massWetKg: 100, massDryKg: 80, moistureContentPercent: 20 })).returning();
    const [leg] = await db.insert(transportLegs).values({ organizationId: TEST_ORG_ID, entityType: "feedstock", entityId: stock.id, distanceKm: 10, loadMassKg: 50, distanceSource: "manual", transportMethodType: "road", isDerived: false }).returning();
    try {
      const detail = await getFeedstockById(ctx, stock.id);
      const page = await getFeedstocks(ctx, { facilityId: facility.id });
      expect(detail.transportDistanceKm).toBeNull();
      expect(detail.hasUsableTransportLeg).toBe(true);
      expect(deriveEntityCertifyReadiness("feedstock", detail).state).toBe("ready");
      expect(page.items.find((row) => row.id === stock.id)?.hasUsableTransportLeg).toBe(true);
      const [foreign] = await withFeedstockTransportReadiness({ ...ctx, organizationId: "foreign-org" }, [stock]);
      expect(foreign.hasUsableTransportLeg).toBe(false);
      await db.update(transportLegs).set({ loadMassKg: 0 }).where(eq(transportLegs.id, leg.id));
      expect((await getFeedstockById(ctx, stock.id)).hasUsableTransportLeg).toBe(false);
    } finally {
      await db.delete(transportLegs).where(eq(transportLegs.id, leg.id));
      await db.delete(feedstocks).where(eq(feedstocks.id, stock.id));
      await cleanupFeedstockFixtureParents(db);
      await db.delete(feedstockTypes).where(eq(feedstockTypes.id, type.id));
      await db.delete(facilities).where(eq(facilities.id, facility.id));
    }
  });
});
