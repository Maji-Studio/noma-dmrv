import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { facilities, feedstocks, feedstockTypes, formulations, organizations, reactors, storageLocations, suppliers } from "@/db/schema";
import { cleanupFeedstockFixtureParents } from "./feedstock-fixture";
import { makeTestOrgContext } from "./test-org";

/** Isolated catalogue parents without operational rows or shared test organizations. */
export async function seedCatalogueStatsOrg() {
  const tag = randomUUID();
  const organizationId = `e2e-catalogue-stats-${tag}`;
  await db.insert(organizations).values({ id: organizationId, name: `E2E Catalogue ${tag}`, slug: organizationId });
  return { tag, ctx: { ...makeTestOrgContext(), organizationId } };
}

export async function cleanupCatalogueStatsOrg(organizationId: string) {
  if (!organizationId.startsWith("e2e-catalogue-stats-")) throw new Error("Expected an isolated catalogue stats organization");
  await db.transaction(async (tx) => {
    await tx.delete(feedstocks).where(eq(feedstocks.organizationId, organizationId));
    await cleanupFeedstockFixtureParents(tx);
    for (const table of [reactors, storageLocations, feedstockTypes, facilities, suppliers, formulations]) {
      await tx.delete(table).where(eq(table.organizationId, organizationId));
    }
    await tx.delete(organizations).where(eq(organizations.id, organizationId));
  });
  await cleanupFeedstockFixtureParents(db);
}
