import { beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { facilities, feedstocks, feedstockTypes } from "@/db/schema";
import { getFeedstockStats } from "@/data-access/feedstocks";
import {
  ensureTestOrg,
  makeTestOrgContext,
  TEST_ORG_ID,
} from "./helpers/test-org";

beforeAll(() => ensureTestOrg());

describe("getFeedstockStats", () => {
  it("scopes every aggregate to the selected feedstock type", async () => {
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const [facility] = await db
      .insert(facilities)
      .values({
        organizationId: TEST_ORG_ID,
        code: `FS-STATS-F-${tag}`,
        name: `Feedstock Stats Facility ${tag}`,
      })
      .returning({ id: facilities.id });
    const types = await db
      .insert(feedstockTypes)
      .values([
        {
          organizationId: TEST_ORG_ID,
          code: `FS-STATS-A-${tag}`,
          name: `Feedstock Stats A ${tag}`,
          category: "forestry",
        },
        {
          organizationId: TEST_ORG_ID,
          code: `FS-STATS-B-${tag}`,
          name: `Feedstock Stats B ${tag}`,
          category: "agricultural",
        },
      ])
      .returning({ id: feedstockTypes.id });
    const stocks = await db
      .insert(feedstocks)
      .values([
        {
          organizationId: TEST_ORG_ID,
          facilityId: facility.id,
          feedstockTypeId: types[0].id,
          code: `FS-STATS-1-${tag}`,
          status: "complete",
          massWetKg: 100,
          massDryKg: 80,
          moistureContentPercent: 20,
        },
        {
          organizationId: TEST_ORG_ID,
          facilityId: facility.id,
          feedstockTypeId: types[1].id,
          code: `FS-STATS-2-${tag}`,
          status: "missing_data",
          massWetKg: 200,
          massDryKg: 120,
          moistureContentPercent: 40,
        },
      ])
      .returning({ id: feedstocks.id });

    try {
      const stats = await getFeedstockStats(makeTestOrgContext(), {
        facilityId: facility.id,
        feedstockTypeId: types[1].id,
      });

      expect(stats).toEqual({
        totalFeedstocks: 1,
        totalDryMassKg: 120,
        avgMoisturePercent: 40,
        completeFeedstocks: 0,
        missingDataFeedstocks: 1,
      });
    } finally {
      await db
        .delete(feedstocks)
        .where(inArray(feedstocks.id, stocks.map((stock) => stock.id)));
      await db
        .delete(feedstockTypes)
        .where(inArray(feedstockTypes.id, types.map((type) => type.id)));
      await db.delete(facilities).where(eq(facilities.id, facility.id));
    }
  });
});
