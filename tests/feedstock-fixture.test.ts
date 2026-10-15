import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { db } from "@/db";
import { facilities, feedstockTypes, storageLocations, suppliers } from "@/db/schema";
import { cleanupFeedstockFixtureParents, feedstockFixtureValues } from "./helpers/feedstock-fixture";
import { ensureTestOrg, TEST_ORG_ID, TEST_SITE_POSITION } from "./helpers/test-org";

it("keeps fixture parents tracked when transactional cleanup rolls back", async () => {
  await ensureTestOrg();
  const tag = randomUUID();
  const [facility] = await db.insert(facilities).values({
    ...TEST_SITE_POSITION, organizationId: TEST_ORG_ID, timezone: "UTC",
    code: `E2E-FIXTURE-${tag}`, name: `E2E Fixture ${tag}`,
  }).returning();
  const [type] = await db.insert(feedstockTypes).values({
    usage: "pyrolysis", organizationId: TEST_ORG_ID, code: `E2E-FIXTURE-${tag}`, name: `E2E Fixture ${tag}`, category: "forestry",
  }).returning();
  try {
    const values = await feedstockFixtureValues(db, {
      organizationId: TEST_ORG_ID, facilityId: facility.id, feedstockTypeId: type.id,
      code: `E2E-FIXTURE-${tag}`, massDryKg: 100,
    });
    await expect(db.transaction(async tx => {
      await cleanupFeedstockFixtureParents(tx);
      throw new Error("Roll back parent cleanup");
    })).rejects.toThrow("Roll back parent cleanup");
    expect(await db.select().from(storageLocations).where(eq(storageLocations.id, values.storageLocationId))).toHaveLength(1);
    expect(await db.select().from(suppliers).where(eq(suppliers.id, values.supplierId))).toHaveLength(1);
    await cleanupFeedstockFixtureParents(db);
    expect(await db.select().from(storageLocations).where(eq(storageLocations.id, values.storageLocationId))).toHaveLength(0);
    expect(await db.select().from(suppliers).where(eq(suppliers.id, values.supplierId))).toHaveLength(0);
  } finally {
    await cleanupFeedstockFixtureParents(db);
    await db.delete(feedstockTypes).where(eq(feedstockTypes.id, type.id));
    await db.delete(facilities).where(eq(facilities.id, facility.id));
  }
});
