import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { realpathSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { test } from "vitest";
import { load } from "js-yaml";

const root = resolve(import.meta.dirname, "..");
const sandboxSuite = "tests/isometric-sandbox.integration.test.ts";
const collectionTimeoutMs = 60_000;

// Collection only: no dotenv reads, application imports, API calls or DB tests.
// The sentinel models another integration suite without importing its DB code.
test("health command collects only sandbox reads even with telemetry enabled", () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "isometric-health-selection-")));
  try {
    mkdirSync(join(directory, "tests"));
    symlinkSync(join(root, "node_modules"), join(directory, "node_modules"));
    writeFileSync(join(directory, sandboxSuite), readFileSync(join(root, sandboxSuite)));
    writeFileSync(join(directory, "tests/unrelated.integration.test.ts"),
      'import { it } from "vitest"; it("DB sentinel must not be selected", () => { throw new Error("collection only"); });');
    writeFileSync(join(directory, "dotenv-stub.ts"), 'export const config = () => ({});');
    writeFileSync(join(directory, "vitest.config.mjs"), `export default {
      resolve: { alias: { dotenv: ${JSON.stringify(join(directory, "dotenv-stub.ts"))} } },
      test: { environment: "node" }
    };`);
    const { scripts } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    // Falling back makes the regression demonstrate the original broad selection.
    const command = scripts["test:isometric-health"] ?? scripts["test:integration"];
    assert.match(command, /^RUN_ISOMETRIC_SANDBOX_TESTS=1 vitest run /);
    const collect = command.replace("vitest run ", '"$1" list ') + " --json";
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      PATH: process.env.PATH,
      HOME: directory,
      ISOMETRIC_ENVIRONMENT: "sandbox",
      ISOMETRIC_CLIENT_SECRET: "collection-only",
      ISOMETRIC_ACCESS_TOKEN: "collection-only",
      ISOMETRIC_DEMO_PROJECT_ID: "collection-only",
      ISOMETRIC_DEMO_FACILITY_ID: "collection-only",
      ISOMETRIC_KNOWN_GHG_ENTRY_SUPPLIER_REF: "collection-only",
    };
    const output = execFileSync("sh", ["-c", collect, "isometric-health-collection", join(root, "node_modules/.bin/vitest")], {
      cwd: directory, env, encoding: "utf8", timeout: collectionTimeoutMs,
    });
    const collected = JSON.parse(output) as Array<{ file: string; name: string }>;
    assert.ok(collected.length > 0, "must collect real read checks");
    assert.deepEqual([...new Set(collected.map((entry) => entry.file))], [join(directory, sandboxSuite)]);
    assert.ok(collected.every((entry) => !entry.name.includes("write path")), "must exclude telemetry writes");
    assert.ok(collected.some((entry) => entry.name.includes("lists projects")));
    assert.ok(collected.some((entry) => entry.name.includes("mass-weighted")));

    assert.throws(() => execFileSync("sh", ["-c", collect, "isometric-health-collection", join(root, "node_modules/.bin/vitest")], {
      cwd: directory, env: { ...env, ISOMETRIC_CLIENT_SECRET: "" },
      encoding: "utf8", timeout: collectionTimeoutMs, stdio: "pipe",
    }), "explicit opt-in without credentials must fail collection");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, collectionTimeoutMs);

const { createRequire } = await import("node:module");
const { runInNewContext } = await import("node:vm");
const require = createRequire(import.meta.url);
type WorkflowStep = {
  id?: string;
  if?: string;
  run?: string;
  uses?: string;
  env?: Record<string, string>;
};
type HealthWorkflow = { jobs: { ping: { steps: WorkflowStep[] } } };
const workflow = load(
  readFileSync(join(root, ".github/workflows/isometric-health.yml"), "utf8"),
) as HealthWorkflow;
const steps = workflow.jobs.ping.steps;
const prerequisites = ["checkout", "pnpm", "node", "install", "credentials"];
const checks = ["api", "coverage", "openapi"];
const required = [...prerequisites, ...checks];

function enabled(id: string, overrides: Record<string, string> = {}, cancelled = false) {
  const step = steps.find((step) => step.id === id);
  assert.ok(step?.if);
  const expression = step.if.replace(/^\$\{\{\s*|\s*\}\}$/g, "");
  return runInNewContext(expression, {
    cancelled: () => cancelled,
    steps: Object.fromEntries(required.map((key) => [key, { outcome: overrides[key] ?? "success" }])),
  });
}

test("workflow checks are independent and prerequisite-gated", () => {
  assert.equal(steps.find((step) => step.id === "api")?.run, "pnpm test:isometric-health");
  for (const id of checks) {
    assert.equal(enabled(id), true);
    assert.equal(enabled(id, { install: "failure" }), false);
    assert.equal(enabled(id, { install: "skipped" }), false);
    assert.equal(enabled(id, {}, true), false);
  }
  assert.equal(enabled("api", { credentials: "failure" }), false);
  assert.equal(enabled("coverage", { credentials: "failure" }), false);
  assert.equal(enabled("coverage", { api: "failure" }), true);
  assert.equal(enabled("openapi", { credentials: "failure", api: "skipped", coverage: "skipped" }), true);
  assert.equal(enabled("openapi", { api: "failure", coverage: "failure" }), true);
  for (const step of steps.filter((step) => step.uses)) {
    assert.match(step.uses!, /@[a-f0-9]{40}$/);
  }
});

test("actual summary shell fails for every incomplete required outcome", () => {
  const summary = steps.at(-1);
  assert.ok(summary?.env && summary.run);
  const summaryEnv = summary.env;
  const summaryRun = summary.run;
  assert.equal(summary.if, "${{ always() }}");
  assert.deepEqual(Object.values(summaryEnv).sort(),
    required.map((id) => `\${{ steps.${id}.outcome }}`).sort());
  const directory = mkdtempSync(join(tmpdir(), "isometric-health-summary-"));
  try {
    const execute = (overrides: Record<string, string> = {}) => execFileSync("bash", ["-e", "-c", summaryRun], {
      cwd: directory,
      env: { NODE_ENV: "test", PATH: process.env.PATH, GITHUB_STEP_SUMMARY: join(directory, "summary.md"),
        ...Object.fromEntries(Object.keys(summaryEnv).map((key) => [key, "success"])), ...overrides },
      stdio: "pipe",
    });
    execute();
    assert.match(readFileSync(join(directory, "summary.md"), "utf8"), /pnpm test:isometric-health/);
    for (const key of Object.keys(summaryEnv)) {
      for (const outcome of ["failure", "skipped", "cancelled", ""]) {
        assert.throws(() => execute({ [key]: outcome }), `${key}=${outcome} must fail`);
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, collectionTimeoutMs);

// Run the actual CLI without local dotenv files or Vitest's app env defaults.
// Missing registry credentials must reach its registry guard, not fail app-env
// validation first; no request can be made with this deliberately empty pair.
test("coverage CLI boots in a clean CI environment and fails closed without registry credentials", () => {
  const coverage = steps.find((step) => step.id === "coverage");
  assert.ok(coverage?.env);
  const directory = mkdtempSync(join(tmpdir(), "isometric-health-coverage-"));
  try {
    mkdirSync(join(directory, "tests/fixtures"), { recursive: true });
    writeFileSync(join(directory, "tests/fixtures/isometric-coverage.json"),
      readFileSync(join(root, "tests/fixtures/isometric-coverage.json")));
    const result = spawnSync(process.execPath, [
      "--import", require.resolve("tsx"),
      join(root, "scripts/isometric-coverage-check.ts"), "--source=fixture",
    ], {
      cwd: directory,
      env: {
        NODE_ENV: "development",
        PATH: process.env.PATH,
        TSX_TSCONFIG_PATH: join(root, "tsconfig.json"),
        ISOMETRIC_ENVIRONMENT: "sandbox",
        ...coverage.env,
      },
      encoding: "utf8",
      timeout: collectionTimeoutMs,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /registry connection is not configured/);
    assert.doesNotMatch(result.stderr, /invalid_type|ECONNREFUSED/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, collectionTimeoutMs);
