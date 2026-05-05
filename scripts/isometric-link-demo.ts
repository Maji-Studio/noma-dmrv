/**
 * Phase 1 setup: list facilities + existing certifier_projects, then link
 * a chosen facility to the Isometric demo project.
 *
 * Usage:
 *   pnpm tsx scripts/isometric-link-demo.ts            # list only
 *   pnpm tsx scripts/isometric-link-demo.ts <facilityId>
 *
 * Hard-coded to the Dark Earth Carbon Ltd's Biochar Demo Project so we never
 * accidentally point a facility at the live Sifuri Halisi project.
 */
import { config } from "dotenv";

config({ path: ".env.local" });

const DEMO_EXTERNAL_PROJECT_ID = "prj_1K5F2F6SN1S0ZKDQ";
const DEMO_PROJECT_NAME = "Dark Earth Carbon Ltd's Biochar Demo Project";

async function main(): Promise<void> {
  const { db } = await import("../src/db");
  const { facilities } = await import("../src/db/schema/facilities");
  const { certifierProjects } = await import("../src/db/schema/certification");
  const { eq, and } = await import("drizzle-orm");

  const facilityRows = await db
    .select({ id: facilities.id, name: facilities.name })
    .from(facilities);

  console.log("Facilities:");
  for (const f of facilityRows) console.log(`  ${f.id}\t${f.name}`);

  const existing = await db.select().from(certifierProjects);
  console.log(`\nExisting certifier_projects rows: ${existing.length}`);
  for (const p of existing) {
    console.log(
      `  facility=${p.facilityId} provider=${p.provider} external=${p.externalProjectId}`
    );
  }

  const targetFacilityId = process.argv[2];
  if (!targetFacilityId) {
    console.log(
      "\nNo facility id passed. Re-run with: pnpm tsx scripts/isometric-link-demo.ts <facilityId>"
    );
    process.exit(0);
  }

  const facility = facilityRows.find((f) => f.id === targetFacilityId);
  if (!facility) {
    console.error(`Facility ${targetFacilityId} not found.`);
    process.exit(1);
  }

  const conflict = existing.find(
    (p) => p.facilityId === targetFacilityId && p.provider === "isometric"
  );
  if (conflict) {
    console.error(
      `Facility ${facility.name} already has isometric certifier_project: external=${conflict.externalProjectId}`
    );
    process.exit(1);
  }

  const externalConflict = existing.find(
    (p) =>
      p.provider === "isometric" &&
      p.externalProjectId === DEMO_EXTERNAL_PROJECT_ID
  );
  if (externalConflict) {
    console.error(
      `Demo project ${DEMO_EXTERNAL_PROJECT_ID} already linked to facility ${externalConflict.facilityId}.`
    );
    process.exit(1);
  }

  const [inserted] = await db
    .insert(certifierProjects)
    .values({
      facilityId: targetFacilityId,
      provider: "isometric",
      externalProjectId: DEMO_EXTERNAL_PROJECT_ID,
      protocolSlug: "biochar",
      metadata: { externalProjectName: DEMO_PROJECT_NAME },
    })
    .returning();

  console.log(
    `\nLinked facility "${facility.name}" → ${DEMO_PROJECT_NAME} (${DEMO_EXTERNAL_PROJECT_ID})`
  );
  console.log(`  certifier_projects.id = ${inserted.id}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
