/**
 * Isometric coverage check (ADR 0032).
 *
 * Uses the same template line contracts as readiness and submission.
 * Entry-only operating lines warn because emissions entries supply their values.
 * Lines without a settled contract, forbidden lines and unmapped inputs fail.
 *
 * Source modes:
 *   --source=fixture (default)  Reads tests/fixtures/isometric-coverage.json.
 *                              CI default — no DATABASE_URL required.
 *   --source=db                 Reads certifier_projects from the local DB.
 *                              Requires DATABASE_URL. Local dev only.
 *
 * Usage:
 *   pnpm isometric:coverage-check                          # fixture mode
 *   pnpm isometric:coverage-check -- --source=db           # DB mode
 */
import { formatUnbindableTemplateInputs } from "../src/lib/isometric/template-binding-coverage";
import { evaluateTemplateCoverage } from "./isometric-coverage-core";
import { config } from "dotenv";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

config({ path: ".env.local" });

// Default NODE_ENV so the env validator (loaded lazily via the dynamic `@/db`
// import on the --source=db path) doesn't reject the local config. Run from the
// CLI without NODE_ENV set, this would otherwise validate as production and
// reject local-fs storage. Set before any env-validating import resolves. Cast
// past the read-only `NODE_ENV` literal type (Next.js augments it).
if (!process.env.NODE_ENV) {
  (process.env as Record<string, string>).NODE_ENV = "development";
}

const FIXTURE_PATH = "tests/fixtures/isometric-coverage.json";

type Source = "fixture" | "db";

// Runtime validation for the fixture file — CI gates on the script's exit
// code, so a typo in the fixture (e.g. `externalProjctId`) must fail loud
// here rather than silently let downstream Isometric calls receive
// `undefined`.
const facilityFixtureSchema = z.object({
  label: z.string().min(1),
  externalProjectId: z.string().min(1),
  defaultRemovalTemplateId: z.string().min(1),
});

const fixtureFileSchema = z.object({
  facilities: z.array(facilityFixtureSchema).min(1),
});

type FacilityFixtureEntry = z.infer<typeof facilityFixtureSchema>;

function parseArgs(): { source: Source } {
  const args = process.argv.slice(2);
  for (const arg of args) {
    if (arg.startsWith("--source=")) {
      const v = arg.slice("--source=".length);
      if (v === "fixture" || v === "db") return { source: v };
      console.error(
        `Invalid --source value "${v}". Expected "fixture" or "db".`,
      );
      process.exit(2);
    }
  }
  return { source: "fixture" };
}

async function loadFromFixture(): Promise<FacilityFixtureEntry[]> {
  const raw = await readFile(join(process.cwd(), FIXTURE_PATH), "utf8");
  const parsed = fixtureFileSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    console.error(
      `Fixture ${FIXTURE_PATH} failed validation:\n${parsed.error.issues
        .map((iss) => `  - ${iss.path.join(".")}: ${iss.message}`)
        .join("\n")}`,
    );
    process.exit(2);
  }
  return parsed.data.facilities;
}

async function loadFromDb(): Promise<FacilityFixtureEntry[]> {
  if (!process.env.DATABASE_URL) {
    console.error(
      "--source=db requires DATABASE_URL. Set it or pass --source=fixture.",
    );
    process.exit(2);
  }
  const { db } = await import("../src/db");
  const { certifierProjects } = await import("../src/db/schema/certification");
  const { facilities } = await import("../src/db/schema/facilities");
  const { eq } = await import("drizzle-orm");

  // innerJoin: facilityId is NOT NULL FK, so a left join can never produce
  // a NULL right side.
  const projects = await db
    .select({
      facilityId: certifierProjects.facilityId,
      facilityCode: facilities.code,
      externalProjectId: certifierProjects.externalProjectId,
      defaultRemovalTemplateId: certifierProjects.defaultRemovalTemplateId,
    })
    .from(certifierProjects)
    .innerJoin(facilities, eq(certifierProjects.facilityId, facilities.id));

  const usableProjects = projects.filter((p) => p.defaultRemovalTemplateId);

  return usableProjects.map((p) => ({
    label: p.facilityCode ?? p.facilityId,
    externalProjectId: p.externalProjectId,
    defaultRemovalTemplateId: p.defaultRemovalTemplateId!,
  }));
}

function printSummary(monitoredInputs: number, components: number, entryOnly: number, failures: number): void {
  console.log(
    `  checked: ${monitoredInputs} monitored inputs / ${components} components; entry-only: ${entryOnly}; failures: ${failures}`,
  );
}

async function main(): Promise<void> {
  const { source } = parseArgs();

  const facilities =
    source === "fixture" ? await loadFromFixture() : await loadFromDb();
  console.log(
    `[coverage-check] source=${source} facilities=${facilities.length}`,
  );
  if (facilities.length === 0) {
    console.log("[coverage-check] nothing to check.");
    return;
  }

  const { getIsometricClientFromEnv, listGhgEntryTemplates } = await import("../src/lib/isometric");
  const client = getIsometricClientFromEnv();
  let failed = 0;

  for (const facility of facilities) {
    console.log(
      `\n[${facility.label}] project=${facility.externalProjectId} template=${facility.defaultRemovalTemplateId}`,
    );

    let template;
    try {
      const templates = await listGhgEntryTemplates(client, facility.externalProjectId);
      template = templates.find(
        (t) => t.id === facility.defaultRemovalTemplateId,
      );
    } catch (err) {
      console.error(
        `  ✗ Failed to list templates: ${err instanceof Error ? err.message : err}`,
      );
      failed += 1;
      printSummary(0, 0, 0, 1);
      continue;
    }
    if (!template) {
      console.error(
        `  ✗ Template ${facility.defaultRemovalTemplateId} not found in project.`,
      );
      failed += 1;
      printSummary(0, 0, 0, 1);
      continue;
    }

    const { failures, entryOnly } = evaluateTemplateCoverage(template);
    for (const finding of entryOnly) {
      console.warn(
        `  ⚠ entry-only: ${finding.componentDisplayName} (${finding.componentId}). Supply values from emissions entries.`,
      );
    }
    for (const line of formatUnbindableTemplateInputs(failures).lines) {
      console.error(`  ✗ ${line}`);
    }
    failed += failures.length;
    const components = template.groups.flatMap((group) => group.components);
    const monitoredInputs = components.flatMap((component) => component.inputs)
      .filter((input) => input.type === "monitored").length;
    printSummary(monitoredInputs, components.length, entryOnly.length, failures.length);
  }

  if (failed > 0) {
    console.error(`\n[coverage-check] FAILED — ${failed} issue(s).`);
    process.exit(1);
  }
  console.log("\n[coverage-check] OK.");
}

main().catch((err) => {
  console.error(
    `[coverage-check] unexpected error: ${err instanceof Error ? err.message : err}`,
  );
  process.exit(1);
});
