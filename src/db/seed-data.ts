/**
 * September 2026 Mafinga demo, created through the UI server actions and Zod
 * schemas so every seeded row is one the forms would have accepted.
 * Run pnpm db:seed after admin bootstrap. An existing FAC-MAFINGA in the
 * bootstrap org exits unchanged. Registry setup needs the credential pair and
 * the encryption key; ISOMETRIC_DEMO_PROJECT_ID and ISOMETRIC_DEMO_FACILITY_ID
 * are optional hints (see docs/database.md). No registry submissions.
 */
import { config } from "dotenv";
import { SeedError } from "@/lib/cli/seed/actions";

config({ path: ".env.local" });
(process.env as Record<string, string | undefined>).NODE_ENV ??= "development";

async function main() {
  // Import all application/env-dependent modules only after dotenv has run.
  const { seedMafinga } = await import("@/lib/cli/seed/run");
  await seedMafinga();
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    // Action failures contain the named step and the action's safe error;
    // never print raw database errors, SQL, environment values, or stacks.
    console.error(error instanceof SeedError ? error.message : "Mafinga seed failed unexpectedly. Check application diagnostics.");
    process.exit(1);
  },
);
