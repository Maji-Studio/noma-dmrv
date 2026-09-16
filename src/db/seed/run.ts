import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { facilities, organizations, users } from "@/db/schema";
import { runWithOrgContext } from "@/lib/auth/server";
import { DEC_ORG_ID } from "../org-defaults";
import { MAFINGA_CODE } from "./constants";
import { SeedError, SeedCounts } from "./actions";
import { registryEnvironment } from "./registry";
import { seedInfrastructure } from "./infrastructure";
import { seedProduction } from "./production";
import { seedDistribution } from "./distribution";

export async function seedMafinga() {
  // The only direct reads: bootstrap identities and facility idempotency.
  const [existing] = await db.select({ id: facilities.id }).from(facilities)
    .where(and(eq(facilities.organizationId, DEC_ORG_ID), eq(facilities.code, MAFINGA_CODE))).limit(1);
  if (existing) {
    console.log(`Mafinga seed already present (${MAFINGA_CODE}); skipping.`);
    return;
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
