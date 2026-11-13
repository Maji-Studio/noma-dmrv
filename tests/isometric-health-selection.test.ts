import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { realpathSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { test } from "vitest";
import { load } from "js-yaml";

const root = resolve(import.meta.dirname, "..");
const healthSuite = "tests/isometric-sandbox-health.integration.test.ts";
const writeSuite = "tests/isometric-sandbox.integration.test.ts";
const sandboxEnvHelper = "tests/helpers/isometric-sandbox-env.ts";
const collectionTimeoutMs = 60_000;

// Collection only: no dotenv reads, application imports, API calls or DB tests.
// The write suite sits beside the health suite so a broadened selection would
// collect it; the sentinel models another integration suite without its DB code.
test("health command collects only the read-only health file", () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "isometric-health-selection-")));
  try {
    mkdirSync(join(directory, "tests/helpers"), { recursive: true });
    symlinkSync(join(root, "node_modules"), join(directory, "node_modules"));
    for (const file of [healthSuite, sandboxEnvHelper]) {
      writeFileSync(join(directory, file), readFileSync(join(root, file)));
    }
    writeFileSync(join(directory, writeSuite),
      'import { it } from "vitest"; it("sandbox write path sentinel", () => { throw new Error("collection only"); });');
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
    assert.doesNotMatch(command, /--testNamePattern|\s-t\s/, "select health checks by file, not by test name");
    const collect = command.replace("vitest run ", '"$1" list ') + " --json";
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      PATH: process.env.PATH,
      HOME: directory,
      ISOMETRIC_ENVIRONMENT: "sandbox",
      ISOMETRIC_CLIENT_SECRET: "collection-only",
      ISOMETRIC_ACCESS_TOKEN: "collection-only",
      ISOMETRIC_DEMO_PROJECT_ID: "collection-only",
      ISOMETRIC_KNOWN_GHG_ENTRY_SUPPLIER_REF: "collection-only",
    };
    const vitest = join(root, "node_modules/.bin/vitest");
    const list = (script: string, listEnv: NodeJS.ProcessEnv = env) =>
      JSON.parse(execFileSync("sh", ["-c", script, "isometric-health-collection", vitest], {
        cwd: directory, env: listEnv, encoding: "utf8", timeout: collectionTimeoutMs, stdio: "pipe",
      })) as Array<{ file: string; name: string }>;

    const collected = list(collect);
    assert.ok(collected.length > 0, "must collect real read checks");
    assert.deepEqual([...new Set(collected.map((entry) => entry.file))], [join(directory, healthSuite)]);
    assert.ok(collected.every((entry) => !entry.name.includes("write path")), "must exclude write suites");
    assert.ok(collected.some((entry) => entry.name.includes("lists projects")));
    assert.ok(collected.some((entry) => entry.name.includes("mass-weighted")));

    // Explicit selection must collect the write sentinel, so exclusion is not vacuous.
    const writes = list(`RUN_ISOMETRIC_SANDBOX_TESTS=1 "$1" list ${writeSuite} --json`);
    assert.ok(writes.some((entry) => entry.name.includes("write path")), "write sentinel must be collected when selected");

    assert.throws(() => list(collect, { ...env, ISOMETRIC_CLIENT_SECRET: "" }),
      "explicit opt-in without credentials must fail collection");
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
    [...required.map((id) => `\${{ steps.${id}.outcome }}`), "${{ steps.openapi.outputs.result }}"].sort());
  assert.equal(summaryEnv.OPENAPI_RESULT, "${{ steps.openapi.outputs.result }}");
  const outcomeKeys = required.map((id) => id.toUpperCase());
  const directory = mkdtempSync(join(tmpdir(), "isometric-health-summary-"));
  try {
    const execute = (overrides: Record<string, string> = {}) => execFileSync("bash", ["-e", "-c", summaryRun], {
      cwd: directory,
      env: { NODE_ENV: "test", PATH: process.env.PATH, GITHUB_STEP_SUMMARY: join(directory, "summary.md"),
        ...Object.fromEntries(outcomeKeys.map((key) => [key, "success"])), OPENAPI_RESULT: "unchanged", ...overrides },
      stdio: "pipe",
    });
    execute();
    assert.match(readFileSync(join(directory, "summary.md"), "utf8"), /pnpm test:isometric-health/);
    execute({ OPENAPI_RESULT: "compatible" });
    assert.match(readFileSync(join(directory, "summary.md"), "utf8"),
      /Public OpenAPI compatibility \| success \(spec changed, still compiles\)/);
    assert.throws(() => execute({ OPENAPI: "failure", OPENAPI_RESULT: "breaking" }));
    assert.match(readFileSync(join(directory, "summary.md"), "utf8"),
      /Public OpenAPI compatibility \| failure \(breaking spec change\)/);
    for (const key of outcomeKeys) {
      for (const outcome of ["failure", "skipped", "cancelled", ""]) {
        assert.throws(() => execute({ [key]: outcome }), `${key}=${outcome} must fail`);
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, collectionTimeoutMs);

const certifyTypesFile = "src/lib/isometric/generated/certify.d.ts";
const removedOperationsScript = "scripts/certify-removed-operations.mjs";
const certifyFixture = `export interface paths {
    "/ghg_entries": {
        parameters: { query?: never; header?: never; path?: never; cookie?: never; };
        get: operations["list"];
        post: operations["create"];
        patch?: never;
    };
}
export interface operations { list: {}; create: {}; }
`;
const compatibleFixture = certifyFixture.replace('patch?: never;', '/** Added operation */ patch: operations["update"];');
const removedFixture = certifyFixture.replace('post: operations["create"];', 'post?: never;');
const openapiRun = steps.find((step) => step.id === "openapi")?.run;
assert.ok(openapiRun);
const diffLineLimit = Number(openapiRun.match(/diff_line_limit=(\d+)/)?.[1]);
assert.ok(diffLineLimit > 0);
const longFixture = `/**\n${Array.from({ length: diffLineLimit }, (_, index) => ` * Description ${index}`).join("\n")}\n */\n`
  + certifyFixture + "// DIFF_TAIL_SENTINEL\n";

test.each([
  { name: "unchanged", generated: certifyFixture, typecheck: 0, regenerate: 0, exit: 0, result: "unchanged" },
  { name: "compatible addition", generated: compatibleFixture, typecheck: 0, regenerate: 0, exit: 0, result: "compatible" },
  { name: "typecheck failure", generated: compatibleFixture, typecheck: 1, regenerate: 0, exit: 1, result: "breaking" },
  { name: "removed operation", generated: removedFixture, typecheck: 0, regenerate: 0, exit: 1, result: "breaking" },
  { name: "removed operation and typecheck failure", generated: removedFixture, typecheck: 1, regenerate: 0, exit: 1, result: "breaking" },
  { name: "regenerate failure", generated: compatibleFixture, typecheck: 0, regenerate: 7, exit: 7, result: "" },
  { name: "long compatible diff", generated: longFixture, typecheck: 0, regenerate: 0, exit: 0, result: "compatible" },
  { name: "long breaking diff", generated: longFixture, typecheck: 1, regenerate: 0, exit: 1, result: "breaking" },
])("actual OpenAPI shell handles $name", (scenario) => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "isometric-health-openapi-")));
  try {
    mkdirSync(join(directory, "src/lib/isometric/generated"), { recursive: true });
    mkdirSync(join(directory, "scripts"));
    mkdirSync(join(directory, "bin"));
    mkdirSync(join(directory, "runner-temp"));
    symlinkSync(join(root, "node_modules"), join(directory, "node_modules"));
    writeFileSync(join(directory, certifyTypesFile), certifyFixture);
    writeFileSync(join(directory, removedOperationsScript), readFileSync(join(root, removedOperationsScript)));
    writeFileSync(join(directory, "generated.d.ts"), scenario.generated);
    writeFileSync(join(directory, "output"), "");
    writeFileSync(join(directory, "summary.md"), "");
    writeFileSync(join(directory, "calls"), "");
    writeFileSync(join(directory, "bin/pnpm"), `#!/bin/bash
set -eo pipefail
echo "$1" >> "$PNPM_CALLS"
case "$1" in
  regenerate-certify-types)
    if [ "$REGENERATE_STATUS" -ne 0 ]; then
      echo 'fixture generation failed' >&2
      exit "$REGENERATE_STATUS"
    fi
    cp "$GENERATED_FILE" "${certifyTypesFile}"
    ;;
  typecheck)
    if [ "$TYPECHECK_STATUS" -ne 0 ]; then
      echo 'fixture tsc error TS2339' >&2
    fi
    exit "$TYPECHECK_STATUS"
    ;;
  *) echo "Unexpected pnpm command: $1" >&2; exit 99 ;;
esac
`, { mode: 0o755 });
    const env: NodeJS.ProcessEnv = {
      PATH: `${join(directory, "bin")}:${process.env.PATH}`,
      NODE_ENV: "test",
      HOME: directory,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      RUNNER_TEMP: join(directory, "runner-temp"),
      GITHUB_OUTPUT: join(directory, "output"),
      GITHUB_STEP_SUMMARY: join(directory, "summary.md"),
      GENERATED_FILE: join(directory, "generated.d.ts"),
      PNPM_CALLS: join(directory, "calls"),
      REGENERATE_STATUS: String(scenario.regenerate),
      TYPECHECK_STATUS: String(scenario.typecheck),
    };
    const git = (...args: string[]) => execFileSync("git", args, {
      cwd: directory, env, encoding: "utf8", stdio: "pipe",
    });
    git("init", "--quiet");
    git("add", certifyTypesFile, removedOperationsScript);
    git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "core.hooksPath=/dev/null",
      "commit", "--quiet", "--no-gpg-sign", "-m", "fixture");
    const execution = spawnSync("bash", ["-eo", "pipefail", "-c", openapiRun], {
      cwd: directory, env, encoding: "utf8", timeout: collectionTimeoutMs,
    });
    const output = readFileSync(join(directory, "output"), "utf8");
    const summary = readFileSync(join(directory, "summary.md"), "utf8");
    const calls = readFileSync(join(directory, "calls"), "utf8");
    const log = execution.stdout + execution.stderr;
    assert.equal(execution.status, scenario.exit, log);
    assert.equal(output, scenario.result ? `result=${scenario.result}\n` : "");
    assert.equal(calls, scenario.result && scenario.result !== "unchanged"
      ? "regenerate-certify-types\ntypecheck\n" : "regenerate-certify-types\n");
    if (scenario.result === "compatible") {
      assert.match(log, /::warning::Certify OpenAPI spec changed/);
      assert.match(summary, /<details>\s*<summary>Certify OpenAPI spec changed, still compiles<\/summary>/);
      assert.match(summary, /```text\n[\s\S]*```diff\n[\s\S]*<\/details>/);
      assert.match(summary, /pnpm regenerate-certify-types/);
    }
    if (scenario.result === "breaking") assert.match(log, /::error::Breaking Certify spec change/);
    if (scenario.generated === removedFixture) assert.match(log, /::error::Removed Certify operation: POST \/ghg_entries/);
    if (scenario.typecheck) assert.match(log, /fixture tsc error TS2339/);
    if (scenario.regenerate) assert.match(log, /fixture generation failed/);
    if (scenario.generated === longFixture) {
      const printed = scenario.result === "compatible" ? summary : log;
      const diff = git("--no-pager", "diff", "--", certifyTypesFile);
      assert.ok(printed.includes(diff.split("\n").slice(0, diffLineLimit).join("\n")));
      assert.match(printed, new RegExp(`Diff truncated to the first ${diffLineLimit} lines\\.`));
      assert.doesNotMatch(printed, /DIFF_TAIL_SENTINEL/);
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
  assert.ok(coverage);
  assert.equal(coverage.env, undefined);
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
