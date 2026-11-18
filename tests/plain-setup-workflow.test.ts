import { readFileSync } from "node:fs";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

interface Step {
  name?: string;
  run?: string;
  env?: Record<string, string>;
}
interface Job {
  if?: string;
  env?: Record<string, string>;
  steps: Step[];
}
interface Workflow {
  on: { workflow_dispatch: { inputs: { action: { options: string[] } } } };
  jobs: Record<string, Job>;
}
const workflow = load(readFileSync(".github/workflows/migrate.yml", "utf8")) as Workflow;
const commands = (job: Job) => job.steps.flatMap(step => step.run ? [step.run] : []).join("\n");

describe("plain setup workflow contract", () => {
  it("tracks the default organization cleanup in a new custom migration", () => {
    const tag = "0178_remove_unused_default_organization";
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8"));
    expect(journal.entries).toContainEqual(expect.objectContaining({ tag }));
    expect(JSON.parse(readFileSync("drizzle/meta/0178_snapshot.json", "utf8"))).toHaveProperty("tables");
    const migration = readFileSync(`drizzle/${tag}.sql`, "utf8");
    expect(migration).toContain("DO $$");
    expect(migration).toContain("'public.organizations'::regclass");
    expect(migration).toContain("fk.contype = 'f'");
  });

  it("keeps a plain reset separate from dev bootstrap", () => {
    const { scripts } = JSON.parse(readFileSync("package.json", "utf8"));
    expect(scripts["db:reset:plain"]).toBe("tsx src/lib/cli/reset-db.ts && pnpm db:migrate");
    expect(scripts["db:reset"]).toBe("tsx src/lib/cli/reset-db.ts && pnpm db:migrate && pnpm db:ensure-admin");
  });

  it("removes the production CLI bootstrap dispatch", () => {
    expect(workflow.on.workflow_dispatch.inputs.action.options).toEqual([
      "reset-seed-staging", "reset-empty-staging", "reset-production",
    ]);
    expect(workflow.jobs).not.toHaveProperty("bootstrap-production");
  });

  it.each(["reset-empty-staging", "reset-production"])("%s resets without admin or registry secrets", (name) => {
    const job = workflow.jobs[name];
    expect(commands(job)).toContain("pnpm db:reset:plain");
    expect(commands(job)).toContain("pnpm db:verify-schema");
    expect(commands(job)).not.toMatch(/pnpm db:ensure-admin|pnpm db:seed(?:\s|$)/);
    const envNames = job.steps.flatMap(step => Object.keys(step.env ?? {}));
    expect(envNames.filter(key => /^(ADMIN_|ISOMETRIC_|CREDENTIALS_ENCRYPTION_KEY|ALLOW_DEV_BOOTSTRAP)/.test(key))).toEqual([]);
    expect(job.if).toContain("github.event_name == 'workflow_dispatch'");
    expect(job.if).toContain("github.event.inputs.confirmation ==");
  });

  it("retains the production reset authorization and branch guards", () => {
    expect(workflow.jobs["reset-production"].if).toContain("github.event.inputs.authorized == 'true'");
    expect(workflow.jobs["reset-production"].if).toContain("github.ref == 'refs/heads/main'");
    expect(workflow.jobs["reset-empty-staging"].if).toContain("github.ref == 'refs/heads/staging'");
  });

  it("keeps seeded staging and automatic production migration paths", () => {
    const seeded = workflow.jobs["reset-seed-staging"];
    expect(commands(seeded)).toContain("pnpm db:reset\n");
    expect(commands(seeded)).toContain("pnpm db:seed\n");
    expect(seeded.steps.find(step => step.env?.ALLOW_DEV_BOOTSTRAP)?.env?.ALLOW_DEV_BOOTSTRAP).toBe("1");
    expect(commands(workflow.jobs["migrate-production"])).toContain("pnpm db:migrate");
    expect(commands(workflow.jobs["migrate-production"])).not.toContain("pnpm db:reset");
  });

  it("exercises CI bootstrap twice in development mode on the fresh-database gate", () => {
    const gate = load(readFileSync(".github/workflows/migration-gate.yml", "utf8")) as Workflow;
    const bootstrapSteps = gate.jobs["fresh-database-gate"].steps.filter(step => step.run === "pnpm db:ensure-admin");
    expect(bootstrapSteps).toHaveLength(2);
    expect(bootstrapSteps.every(step => step.env?.NODE_ENV === "development")).toBe(true);
  });

  it("asserts zero organizations and users immediately after migration and before bootstrap", () => {
    const gate = load(readFileSync(".github/workflows/migration-gate.yml", "utf8")) as Workflow;
    const steps = gate.jobs["fresh-database-gate"].steps;
    const migrationIndex = steps.findIndex(step => step.name === "Apply full migration chain to an empty database");
    expect(migrationIndex).toBeGreaterThanOrEqual(0);
    const assertion = steps[migrationIndex + 1];
    expect(assertion.name).toBe("Assert plain setup has no organizations or users");
    expect(assertion.run).toContain("SELECT (SELECT count(*) FROM organizations) AS organizations, (SELECT count(*) FROM users) AS users");
    expect(assertion.run).toContain("Number(organizations) !== 0 || Number(users) !== 0");
    expect(assertion.run).toContain("process.exitCode = 1");
    expect(assertion.run).toContain("process.env.DATABASE_URL");
    expect(steps[migrationIndex + 2].run).toBe("pnpm db:ensure-admin");
  });
});
