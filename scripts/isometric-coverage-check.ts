/**
 * Isometric coverage check (ADR 0005 scope rules / ADR 0018, Plan §7 / B1).
 *
 * Fails CI if:
 *   1. Any (group, blueprint, input) tuple in a live Removal Template is
 *      missing from INPUT_MAPPING — AND not in PERIOD_INPUT_TUPLES.
 *   2. Any tuple in the template is in PERIOD_INPUT_TUPLES (= the template
 *      itself is wrong: a period input declared as REMOVAL-scope; those
 *      belong to PROJECT-scope Components authored in the Isometric UI).
 *
 * (The former PROJECT-scope drift checks against noma's LCA journal were
 * removed with the journal itself — ADR 0018.)
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
  facilities: z.array(facilityFixtureSchema),
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
  if (parsed.data.facilities.length === 0) {
    // Soft-skip: the daily isometric-health workflow runs this in fixture
    // mode by default, and CI must not fail before an operator has authored
    // the sandbox fixture entry. Fall through to the empty-array branch in
    // main(), which logs "nothing to check" and exits 0. Populate
    // facilities[] in the fixture to enable the assertion (see
    // docs/isometric/sandbox-template-authoring.md).
    console.warn(
      `[coverage-check] Fixture ${FIXTURE_PATH} has no facility entries — skipping. Add the sandbox project to assert against.`,
    );
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

  const { listGhgEntryTemplates } = await import("../src/lib/isometric");
  const { lookupInputMapping, lookupPeriodInputTuple } = await import(
    "../src/lib/isometric/transformers/datapoint"
  );

  let failed = 0;

  for (const facility of facilities) {
    console.log(
      `\n[${facility.label}] project=${facility.externalProjectId} template=${facility.defaultRemovalTemplateId}`,
    );

    // ── 1. Template input coverage ────────────────────────────────────
    let template;
    try {
      const templates = await listGhgEntryTemplates(facility.externalProjectId);
      template = templates.find(
        (t) => t.id === facility.defaultRemovalTemplateId,
      );
    } catch (err) {
      console.error(
        `  ✗ Failed to list templates: ${err instanceof Error ? err.message : err}`,
      );
      failed += 1;
      continue;
    }
    if (!template) {
      console.error(
        `  ✗ Template ${facility.defaultRemovalTemplateId} not found in project.`,
      );
      failed += 1;
      continue;
    }

    // Each group + component + input is one tuple to cover.
    type Tuple = { group: string; blueprint: string; input: string };
    const tuples: Tuple[] = [];
    for (const group of template.groups ?? []) {
      for (const component of group.components ?? []) {
        for (const rtcInput of component.inputs ?? []) {
          if (rtcInput.type !== "monitored") continue;
          tuples.push({
            group: group.key,
            blueprint: component.blueprint_key,
            input: rtcInput.input_key,
          });
        }
      }
    }
    console.log(`  template monitored tuples: ${tuples.length}`);

    for (const t of tuples) {
      const mapping = lookupInputMapping(t.group, t.blueprint, t.input);
      if (mapping) continue;
      const periodTuple = lookupPeriodInputTuple(t.group, t.blueprint, t.input);
      if (periodTuple) {
        console.error(
          `  ✗ scope-conflict: template declares ${t.group}/${t.blueprint}/${t.input} as REMOVAL-scope, but it belongs to PROJECT (category="${periodTuple.category}"). Remove from template (ADR 0018).`,
        );
        failed += 1;
      } else {
        console.error(
          `  ✗ missing INPUT_MAPPING entry: ${t.group}/${t.blueprint}/${t.input}`,
        );
        failed += 1;
      }
    }
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
