/**
 * Cheap environment check for the Mafinga seed, meant to run BEFORE a
 * destructive reset. `src/config/env.ts` validates at module load, so importing
 * it is the whole check: a step that is missing a required variable fails here
 * instead of after the database has been wiped.
 * Mirrors the dotenv and NODE_ENV handling in src/db/seed-data.ts.
 */
import { config } from "dotenv";

config({ path: ".env.local" });
(process.env as Record<string, string | undefined>).NODE_ENV ??= "development";

/** Names and messages only: an environment value must never reach the log. */
function describeFailure(error: unknown): string {
  const issues = (error as { issues?: Array<{ path?: PropertyKey[]; message?: string }> })
    .issues;
  if (!Array.isArray(issues)) {
    return "Seed environment preflight failed. Check the step's environment configuration.";
  }
  const lines = issues.map(
    (issue) => `  ${(issue.path ?? []).join(".") || "(root)"}: ${issue.message ?? "invalid"}`,
  );
  return ["Seed environment preflight failed:", ...lines].join("\n");
}

async function main() {
  await import("../../config/env");
  console.log("Seed environment preflight passed.");
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(describeFailure(error));
    process.exit(1);
  },
);
