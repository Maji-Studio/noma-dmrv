/**
 * Phase 1 setup: list facilities + existing certifier_projects, then link
 * a chosen facility to the Isometric demo project.
 *
 * Usage:
 *   pnpm tsx scripts/isometric-link-demo.ts            # list only
 *   pnpm tsx scripts/isometric-link-demo.ts <facilityId> [projectId]
 *
 * Defaults to Dark Earth Carbon Ltd's Biochar Demo Project so we never
 * accidentally point a facility at the live Sifuri Halisi project. Override
 * with [projectId] or ISOMETRIC_DEMO_PROJECT_ID for sandbox validation.
 */
import { config } from "dotenv";

config({ path: ".env.local" });

const DEMO_EXTERNAL_PROJECT_ID = "prj_1K5F2F6SN1S0ZKDQ";
const DEMO_PROJECT_NAME = "Dark Earth Carbon Ltd's Biochar Demo Project";

async function main(): Promise<void> {
  const { db } = await import("../src/db");
  const { facilities } = await import("../src/db/schema/facilities");
  const { certifierProjects } = await import("../src/db/schema/certification");

  const facilityRows = await db
    .select({ id: facilities.id })
    .from(facilities);

  console.log("Facilities:");
  for (const f of facilityRows) console.log(`  ${f.id}`);

  const existing = await db.select().from(certifierProjects);
  console.log(`\nExisting certifier_projects rows: ${existing.length}`);
  for (const p of existing) {
    console.log(
      `  facility=${p.facilityId} provider=${p.provider} external=${p.externalProjectId}`
    );
  }

  const targetFacilityId = process.argv[2];
  const demoExternalProjectId =
    process.argv[3] ??
    process.env.ISOMETRIC_DEMO_PROJECT_ID ??
    DEMO_EXTERNAL_PROJECT_ID;
  const demoProjectName =
    process.env.ISOMETRIC_DEMO_PROJECT_NAME ?? DEMO_PROJECT_NAME;
  if (!targetFacilityId) {
    console.log(
      "\nNo facility id passed. Re-run with: pnpm tsx scripts/isometric-link-demo.ts <facilityId> [projectId]"
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
      `Facility ${facility.id} already has isometric certifier_project: external=${conflict.externalProjectId}`
    );
    process.exit(1);
  }

  const alsoLinkedTo = existing
    .filter(
      (p) =>
        p.provider === "isometric" &&
        p.externalProjectId === demoExternalProjectId
    )
    .map((p) => p.facilityId);
  if (alsoLinkedTo.length > 0) {
    console.log(
      `Note: demo project ${demoExternalProjectId} is also linked to facility(s): ${alsoLinkedTo.join(", ")}.`
    );
  }

  const [inserted] = await db
    .insert(certifierProjects)
    .values({
      facilityId: targetFacilityId,
      provider: "isometric",
      externalProjectId: demoExternalProjectId,
      protocolSlug: "biochar",
      metadata: { externalProjectName: demoProjectName },
    })
    .returning();

  console.log(
    `\nLinked facility ${facility.id} → ${demoExternalProjectId}`
  );
  console.log(`  certifier_projects.id = ${inserted.id}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
