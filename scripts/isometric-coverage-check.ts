/**
 * Isometric coverage check (ADR 0005 scope rules / ADR 0018, Plan §7 / B1).
 *
 * Fails CI if:
 *   1. Any (group, blueprint, input) tuple in a live Removal Template is
 *      missing from INPUT_MAPPING or the explicit sequestration bindings.
 *   2. Any tuple in the template is in PERIOD_INPUT_TUPLES (= the template
 *      itself is wrong: a period input declared as REMOVAL-scope; those
 *      belong to PROJECT-scope Components authored in the Isometric UI),
 *      unless that exact sandbox component/input is fixture-allowlisted.
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
  allowedSandboxPeriodInputs: z.array(z.string().min(1)).default([]),
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
    allowedSandboxPeriodInputs: [],
  }));
}

function periodInputAllowlistKey(tuple: {
  group: string;
  blueprint: string;
  component: string;
  input: string;
}): string {
  return [
    tuple.group,
    tuple.blueprint,
    tuple.component.trim().toLowerCase(),
    tuple.input,
  ].join("/");
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
  const {
    lookupInputMapping,
    lookupPeriodInputTuple,
    resolveDatapointSource,
  } = await import(
    "../src/lib/isometric/transformers/datapoint"
  );
  const { getSequestrationInputBinding } = await import(
    "../src/lib/isometric/transformers/sequestration-binding"
  );

  let failed = 0;

  for (const facility of facilities) {
    console.log(
      `\n[${facility.label}] project=${facility.externalProjectId} template=${facility.defaultRemovalTemplateId}`,
    );

    // ── 1. Template input coverage ────────────────────────────────────
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
    type Tuple = {
      group: string;
      blueprint: string;
      component: string;
      input: string;
    };
    const tuples: Tuple[] = [];
    for (const group of template.groups ?? []) {
      for (const component of group.components ?? []) {
        for (const rtcInput of component.inputs ?? []) {
          if (rtcInput.type !== "monitored") continue;
          tuples.push({
            group: group.key,
            blueprint: component.blueprint_key,
            component: component.display_name,
            input: rtcInput.input_key,
          });
        }
      }
    }
    console.log(`  template monitored tuples: ${tuples.length}`);
    const allowedSandboxPeriodInputs = new Set(
      facility.allowedSandboxPeriodInputs,
    );
    const observedAllowedSandboxPeriodInputs = new Map<string, number>();

    for (const t of tuples) {
      // Scope-conflict check runs BEFORE accepting a mapping. A period tuple
      // must fail unless its exact component name is an explicit carve-out
      // (mirrors the guard ordering in transformers/datapoint.ts, ADR 0018).
      const periodTuple = lookupPeriodInputTuple(
        t.group,
        t.blueprint,
        t.input,
        t.component,
      );
      if (periodTuple) {
        const allowlistKey = periodInputAllowlistKey(t);
        if (allowedSandboxPeriodInputs.has(allowlistKey)) {
          observedAllowedSandboxPeriodInputs.set(
            allowlistKey,
            (observedAllowedSandboxPeriodInputs.get(allowlistKey) ?? 0) + 1,
          );
          console.warn(
            `  ⚠ sandbox-only period input allowlisted: ${allowlistKey}`,
          );
          continue;
        }
        console.error(
          `  ✗ scope-conflict: template declares ${t.group}/${t.blueprint}/${t.input} as REMOVAL-scope, but it belongs to PROJECT (category="${periodTuple.category}"). Remove from template (ADR 0018).`,
        );
        failed += 1;
        continue;
      }
      const mapping = lookupInputMapping(t.group, t.blueprint, t.input);
      if (!mapping) {
        if (
          t.group === "co2-stored" &&
          getSequestrationInputBinding(t.blueprint, t.input)
        ) {
          continue;
        }
        console.error(
          `  ✗ missing removal input binding: ${t.group}/${t.blueprint}/${t.input}`,
        );
        failed += 1;
        continue;
      }
      try {
        resolveDatapointSource(mapping, t.component);
      } catch (err) {
        console.error(
          `  ✗ invalid component mapping: ${t.group}/${t.blueprint}/${t.input} (${t.component}): ${err instanceof Error ? err.message : err}`,
        );
        failed += 1;
      }
    }

    for (const allowlistKey of allowedSandboxPeriodInputs) {
      const observedCount =
        observedAllowedSandboxPeriodInputs.get(allowlistKey) ?? 0;
      if (observedCount === 1) continue;
      console.error(
        `  ✗ sandbox period-input allowlist entry must match exactly one live template input; found ${observedCount}: ${allowlistKey}`,
      );
      failed += 1;
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
