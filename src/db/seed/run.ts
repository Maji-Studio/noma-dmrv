import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { deliveries, facilities, organizations, users } from "@/db/schema";
import { runWithOrgContext } from "@/lib/auth/server";
import { DEC_ORG_ID } from "../org-defaults";
import { FACILITY, MAFINGA_CODE } from "./constants";
import { SeedError, SeedCounts } from "./actions";
import { registryEnvironment } from "./registry";
import { seedInfrastructure } from "./infrastructure";
import { seedProduction } from "./production";
import { seedDistribution } from "./distribution";

/**
 * The seed creates the facility first and marks it with MAFINGA_CODE only on
 * the next action, so a crash in between leaves an unmarked facility that a
 * rerun would duplicate. Match either identifier.
 */
async function findSeededFacility(): Promise<{ id: string } | null> {
  const [existing] = await db.select({ id: facilities.id }).from(facilities)
    .where(and(
      eq(facilities.organizationId, DEC_ORG_ID),
      or(eq(facilities.code, MAFINGA_CODE), eq(facilities.name, FACILITY.name)),
    )).limit(1);
  return existing ?? null;
}

/**
 * Completion marker: the delivery in seedDistribution is the last entity the
 * seed creates, so its absence means an earlier step failed and the dataset is
 * incomplete.
 */
async function hasSeededDelivery(facilityId: string): Promise<boolean> {
  const [delivery] = await db.select({ id: deliveries.id }).from(deliveries)
    .where(and(
      eq(deliveries.organizationId, DEC_ORG_ID),
      eq(deliveries.facilityId, facilityId),
    )).limit(1);
  return Boolean(delivery);
}

export async function seedMafinga() {
  // The only direct reads: bootstrap identities and facility idempotency.
  const existing = await findSeededFacility();
  if (existing) {
    if (await hasSeededDelivery(existing.id)) {
      console.log(`Mafinga seed already present (${MAFINGA_CODE}); skipping.`);
      return;
    }
    throw new SeedError("bootstrap: a partial Mafinga seed exists in this database. Run pnpm db:reset before reseeding; reseeding on top of it would duplicate rows.");
  }
  const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(1);
  const [organization] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, DEC_ORG_ID)).limit(1);
  if (!admin || !organization) throw new SeedError("bootstrap: run the existing admin/organization bootstrap before db:seed");
  // Fail configuration checks before creating the facility idempotency marker.
  registryEnvironment();
  const counts = new SeedCounts();
  await runWithOrgContext({ userId: admin.id, organizationId: DEC_ORG_ID, orgRole: "owner", isPlatformAdmin: true }, async () => {
    try {
      const infra = await seedInfrastructure(counts);
      await seedProduction(infra, counts);
      await seedDistribution(infra, counts);
      console.log("Mafinga seed completed through delivery. Entity counts:");
      counts.print();
      console.log(`Isometric: ${infra.registryStatus}`);
    } catch (error) {
      console.error("Mafinga seed stopped. Created entity counts (partial dataset):");
      counts.print();
      throw error;
    }
  });
}
