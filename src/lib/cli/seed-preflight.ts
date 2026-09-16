/**
 * Cheap environment check for the Mafinga seed, meant to run BEFORE a
 * destructive reset. `src/config/env.ts` validates at module load, so importing
 * it is most of the check, and the seed's own registry configuration check
 * covers the rest: a step with a missing or malformed variable fails here
 * instead of after the database has been wiped.
 * Mirrors the dotenv and NODE_ENV handling in src/db/seed-data.ts.
 */
import { config } from "dotenv";
import { describeSeedFailure } from "./seed/actions";

config({ path: ".env.local" });
(process.env as Record<string, string | undefined>).NODE_ENV ??= "development";

async function main() {
  await import("../../config/env");
  // Registry hints are not part of envSchema; the seed rejects them later.
  // Checking them here keeps a bad ISOMETRIC_DEMO_* value from wiping first.
  const { registryEnvironment } = await import("./seed/registry");
  registryEnvironment();
  console.log("Seed environment preflight passed.");
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    // Names and messages only: an environment value must never reach the log.
    console.error(`Seed environment preflight failed. ${describeSeedFailure(error)}`);
    process.exit(1);
  },
);
