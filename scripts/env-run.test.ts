import { EventEmitter } from "events";
import { spawn, spawnSync, type ChildProcess } from "child_process";
import * as fs from "fs";
import { constants, tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENV_RUN_USAGE, parseEnvRunArgs, runEnvCommand } from "./env-run";
import {
  REQUIRED_DEPLOYED_VARS,
  REQUIRED_LOCAL_VARS,
  VAULT,
  itemNameForEnvironment,
  templateForEnvironment,
} from "./env-tpl-utils";

// No test can launch op or another process, including on an unexpected code path.
vi.mock("child_process", () => ({ spawn: vi.fn(), spawnSync: vi.fn() }));
// ESM namespaces cannot be spied on; wrap file access for template edge cases.
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    readFileSync: vi.fn(actual.readFileSync),
    writeFileSync: vi.fn(actual.writeFileSync),
  };
});
vi.mock("os", async (importOriginal) => ({
  ...await importOriginal<typeof import("os")>(),
  tmpdir: vi.fn(),
}));

const PRIVATE_FILE_MODE = 0o600;
const FILE_PERMISSION_MASK = 0o777;
const SIGNAL_EXIT_CODE_BASE = 128;
const COMMAND_FAILURE_CODE = 23;
const LONG_FIXTURE_VALUE_LENGTH = 5000;
const ENVIRONMENTS = ["local", "staging", "prod"] as const;
const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
const OPTIONAL_TIMEOUTS = [
  "DB_POOL_IDLE_TIMEOUT_MS",
  "DB_POOL_CONNECTION_TIMEOUT_MS",
  "DB_POOL_LOCK_TIMEOUT_MS",
];

describe("parseEnvRunArgs", () => {
  it.each(ENVIRONMENTS)("parses %s and preserves command arguments verbatim", (environment) => {
    const command = ["pnpm", "-s", "task", "--", "space here", "$(example)", ";", ""];
    expect(parseEnvRunArgs([`--1p-env=${environment}`, "--", ...command])).toEqual({
      environment, allowProduction: false, command,
    });
  });

  it("accepts the production flag before the separator", () => {
    expect(parseEnvRunArgs(["--allow-production", "--1p-env=prod", "--", "task"]))
      .toMatchObject({ environment: "prod", allowProduction: true });
  });

  it.each([
    [],
    ["--1p-env=local", "task"],
    ["--1p-env=local", "--"],
    ["--1p-env=local", "--", ""],
    ["--", "task"],
    ["--1p-env=production", "--", "task"],
    ["--1p-env=unknown", "--", "task"],
    ["--1p-env=", "--", "task"],
    ["--1p-env=local", "--1p-env=staging", "--", "task"],
    ["--1p-env=local", "--unknown", "--", "task"],
  ])("rejects invalid arguments: %j", (...args) => {
    expect(() => parseEnvRunArgs(args)).toThrow();
  });
});

describe("runEnvCommand", () => {
  let testDirectory: string;
  let fixtureDirectory: string;
  let child: ChildProcess;
  let writtenFile: string | undefined;
  let templateDuringRun: string;

  function listFields(fields: Iterable<string>) {
    vi.mocked(spawnSync).mockReturnValue({
      status: 0, signal: null, pid: 0, output: [], stderr: "",
      stdout: JSON.stringify({ fields: [...fields].map((label) => ({ label })) }),
    });
  }

  function argsFor(environment: typeof ENVIRONMENTS[number]): string[] {
    return [
      `--1p-env=${environment}`,
      ...(environment === "prod" ? ["--allow-production"] : []),
      "--", "pnpm", "-s", "feedstock:recalculate", "--dry-run",
    ];
  }

  function captureTempFile(argv: readonly string[]) {
    writtenFile = argv[1].slice("--env-file=".length);
    // tmpdir is mocked into the repository, so tests never read outside it.
    templateDuringRun = fs.readFileSync(writtenFile, "utf-8");
    expect(fs.statSync(writtenFile).mode & FILE_PERMISSION_MASK).toBe(PRIVATE_FILE_MODE);
    expect(writtenFile.startsWith(testDirectory + "/noma-dmrv-env-run-")).toBe(true);
  }

  beforeEach(() => {
    vi.mocked(spawn).mockReset();
    vi.mocked(spawnSync).mockReset();
    fs.mkdirSync(join(process.cwd(), ".cache"), { recursive: true });
    testDirectory = fs.mkdtempSync(join(process.cwd(), ".cache", "env-run-tests-"));
    fixtureDirectory = fs.mkdtempSync(join(process.cwd(), ".cache", "env-run-fixtures-"));
    for (const templateFile of [".env.tpl", ".env.local.tpl"]) {
      fs.copyFileSync(join(process.cwd(), templateFile), join(fixtureDirectory, templateFile));
    }
    vi.spyOn(process, "cwd").mockReturnValue(fixtureDirectory);
    vi.mocked(tmpdir).mockReturnValue(testDirectory);
    child = Object.assign(new EventEmitter(), { kill: vi.fn(() => true) }) as unknown as ChildProcess;
    writtenFile = undefined;
    templateDuringRun = "";
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    listFields(REQUIRED_DEPLOYED_VARS);
    vi.mocked(spawn).mockImplementation((_file, argv) => {
      captureTempFile(argv as readonly string[]);
      queueMicrotask(() => child.emit("exit", 0, null));
      return child;
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(testDirectory, { recursive: true, force: true });
    fs.rmSync(fixtureDirectory, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("prints usage and fails without reading an item for invalid arguments", async () => {
    expect(await runEnvCommand(["--1p-env=staging", "task"])).toBe(1);
    expect(console.error).toHaveBeenCalledWith(ENV_RUN_USAGE);
    expect(spawnSync).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([
    ["--1p-env=prod", "--", "task"],
    ["--1p-env=prod", "--", "task", "--allow-production"],
  ])("refuses production before item access: %j", async (...args) => {
    expect(await runEnvCommand(args)).toBe(1);
    expect(console.error).toHaveBeenCalledExactlyOnceWith(
      "Production commands can change live data. Pass --allow-production to continue."
    );
    expect(spawnSync).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(fs.readdirSync(testDirectory)).toEqual([]);
  });

  it.each(ENVIRONMENTS)("filters optional fields for %s and uses its template and item", async (environment) => {
    const required = environment === "local" ? REQUIRED_LOCAL_VARS : REQUIRED_DEPLOYED_VARS;
    listFields(required);
    expect(await runEnvCommand(argsFor(environment))).toBe(0);
    const itemName = itemNameForEnvironment(environment);
    const expectedItemName = `noma-dmrv env ${environment === "prod" ? "production" : environment}`;
    expect(itemName).toBe(expectedItemName);
    expect(spawnSync).toHaveBeenCalledExactlyOnceWith(
      "op", ["item", "get", expectedItemName, "--vault", VAULT, "--format", "json"],
      { encoding: "utf-8" }
    );
    expect(templateDuringRun).toContain(`DATABASE_URL="op://${VAULT}/${itemName}/DATABASE_URL"`);
    // The local template does not declare NODE_ENV; preserve its existing behavior.
    expect(templateDuringRun.match(/^NODE_ENV=(.*)$/m)?.[1]).toBe(
      environment === "local" ? undefined : environment === "prod" ? "production" : "development"
    );
    for (const name of OPTIONAL_TIMEOUTS) {
      expect(templateDuringRun).not.toMatch(new RegExp(`^${name}=`, "m"));
      expect(console.warn).toHaveBeenCalledWith(`        ${name}`);
    }
    const skippedNames = [...templateDuringRun.matchAll(/^# ([A-Z_][A-Z0-9_]*) skipped /gm)].map(([, name]) => name);
    for (const name of skippedNames) {
      expect(templateDuringRun).not.toMatch(new RegExp(`^${name}=`, "m"));
    }
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(
      `Skipping ${skippedNames.length} optional variable(s) with no field in "${itemName}":`
    ));
    if (environment === "local") {
      expect(templateDuringRun).toContain("# CRON_SECRET skipped");
      expect(templateDuringRun).toContain("# ADMIN_PASSWORD skipped");
    } else {
      expect(templateDuringRun).toContain(`CRON_SECRET="op://${VAULT}/${itemName}/CRON_SECRET"`);
      expect(templateDuringRun).not.toContain("ADMIN_PASSWORD");
    }
    expect(fs.existsSync(writtenFile!)).toBe(false);
    expect(fs.readdirSync(testDirectory)).toEqual([]);
  });

  const missingRequiredCases = ENVIRONMENTS.flatMap((environment) =>
    [...(environment === "local" ? REQUIRED_LOCAL_VARS : REQUIRED_DEPLOYED_VARS)]
      .map((field) => ({ environment, field }))
  );
  it.each(missingRequiredCases)("aborts on missing $field for $environment", async ({ environment, field }) => {
    const fields = new Set(environment === "local" ? REQUIRED_LOCAL_VARS : REQUIRED_DEPLOYED_VARS);
    fields.delete(field);
    listFields(fields);
    expect(await runEnvCommand(argsFor(environment))).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(
      `Required field(s) missing from 1Password item "${itemNameForEnvironment(environment)}": ${field}`
    ));
    expect(spawn).not.toHaveBeenCalled();
    expect(fs.readdirSync(testDirectory)).toEqual([]);
  });

  it("names all missing required fields", async () => {
    listFields([]);
    expect(await runEnvCommand(argsFor("local"))).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining([...REQUIRED_LOCAL_VARS].join(", ")));
    expect(spawn).not.toHaveBeenCalled();
  });

  it("passes exact op run argv without a shell and inherits stdio", async () => {
    const command = ["pnpm", "-s", "feedstock:recalculate", "--dry-run", "space here", "$(example)", ";"];
    expect(await runEnvCommand(["--1p-env=staging", "--", ...command])).toBe(0);
    expect(spawn).toHaveBeenCalledExactlyOnceWith(
      "op", ["run", `--env-file=${writtenFile}`, "--", ...command],
      { stdio: "inherit", env: expect.any(Object) }
    );
    expect(templateDuringRun).toContain("NODE_ENV=development");
  });

  it("keeps available optional references and emits no warning for a complete item", async () => {
    const template = fs.readFileSync(join(process.cwd(), ".env.tpl"), "utf-8");
    const fields = [...template.matchAll(/^([A-Z_][A-Z0-9_]*)="op:\/\//gm)].map((match) => match[1]);
    listFields(fields);
    expect(await runEnvCommand(argsFor("prod"))).toBe(0);
    expect(templateDuringRun).toBe(
      templateForEnvironment(template, "prod").replace(/^NODE_ENV=.*$/m, "NODE_ENV=production")
    );
    expect(console.warn).not.toHaveBeenCalled();
  });

  it.each([true, false])("appends production NODE_ENV when absent (trailing newline: %s)", async (trailingNewline) => {
    const template = `DATABASE_URL="op://${VAULT}/noma-dmrv env staging/DATABASE_URL"`;
    vi.mocked(fs.readFileSync).mockReturnValueOnce(template + (trailingNewline ? "\n" : ""));
    expect(await runEnvCommand(argsFor("prod"))).toBe(0);
    expect(templateDuringRun).toContain(`${templateForEnvironment(template, "prod")}\nNODE_ENV=production\n`);
  });

  it.each(ENVIRONMENTS)("removes all %s template names from the inherited child env", async (environment) => {
    const templateFile = environment === "local" ? ".env.local.tpl" : ".env.tpl";
    const template = fs.readFileSync(join(process.cwd(), templateFile), "utf-8");
    const names = [...template.matchAll(/^([A-Z_][A-Z0-9_]*)=/gm)].map((match) => match[1]);
    vi.stubEnv("NODE_ENV", "mock-parent-value");
    for (const name of names) vi.stubEnv(name, "mock-parent-value");
    vi.stubEnv("ENV_RUN_TEST_INHERITED", "mock-unrelated-value");
    listFields(environment === "local" ? REQUIRED_LOCAL_VARS : REQUIRED_DEPLOYED_VARS);

    expect(await runEnvCommand(argsFor(environment))).toBe(0);
    const childEnv = vi.mocked(spawn).mock.calls[0][2]!.env!;
    for (const name of names) {
      expect(childEnv).not.toHaveProperty(name);
      expect(process.env[name]).toBe("mock-parent-value");
    }
    expect(childEnv.ENV_RUN_TEST_INHERITED).toBe("mock-unrelated-value");
    if (environment === "local") expect(childEnv.NODE_ENV).toBe("mock-parent-value");
    for (const name of ["ADMIN_EMAIL", "ISOMETRIC_ENVIRONMENT", "ISOMETRIC_CLIENT_SECRET", "ISOMETRIC_ACCESS_TOKEN"]) {
      expect(templateDuringRun).not.toMatch(new RegExp(`^${name}=`, "m"));
    }
  });

  it.each(["staging", "prod"] as const)("warns before %s runs about local fallback names without values", async (environment) => {
    const fixtureValue = "env-run-fixture-value-must-stay-private";
    const fallbackNames = ["ADMIN_EMAIL", "ADMIN_PASSWORD", "GEO_PROVIDER", "ISOMETRIC_ENVIRONMENT"];
    fs.writeFileSync(join(fixtureDirectory, ".env.local"), [
      ...fallbackNames.map((name) => `${name}=${fixtureValue}`),
      `DATABASE_URL=${fixtureValue}`,
      `NODE_ENV=${fixtureValue}`,
      `ADMIN_EMAIL=${fixtureValue}`,
      `# COMMENTED_OUT=${fixtureValue}`,
      `  # INDENTED_COMMENT=${fixtureValue}`,
      `INVALID-NAME=${fixtureValue}`,
      `NOT_AN_ASSIGNMENT ${fixtureValue}`,
    ].join("\r\n"));
    vi.stubEnv("ADMIN_PASSWORD", "mock-parent-value");

    expect(await runEnvCommand(argsFor(environment))).toBe(0);
    expect(console.warn).toHaveBeenLastCalledWith(
      `Commands that load .env.local will use your local values for: ${fallbackNames.join(", ")}`
    );
    const warnings = vi.mocked(console.warn);
    expect(warnings.mock.invocationCallOrder.at(-1)).toBeLessThan(vi.mocked(spawn).mock.invocationCallOrder[0]);
    const output = JSON.stringify([...warnings.mock.calls, ...vi.mocked(console.error).mock.calls]);
    expect(output).not.toContain(fixtureValue);
    for (const name of ["DATABASE_URL", "NODE_ENV", "COMMENTED_OUT", "INDENTED_COMMENT", "INVALID-NAME"]) {
      expect(warnings.mock.calls.at(-1)![0]).not.toContain(name);
    }
  });

  it("excludes provided optional names but includes item fields outside the template", async () => {
    listFields([...REQUIRED_DEPLOYED_VARS, "ISOMETRIC_ENVIRONMENT", "GEO_PROVIDER", "LOCAL_ONLY_VAR"]);
    fs.writeFileSync(join(fixtureDirectory, ".env.local"), [
      "ISOMETRIC_ENVIRONMENT=fixture-environment",
      "GEO_PROVIDER=fixture-provider",
      "DATABASE_URL=fixture-database",
      "NODE_ENV=fixture-mode",
      "  export LOCAL_ONLY_VAR =fixture-local-only",
    ].join("\n"));

    expect(await runEnvCommand(argsFor("staging"))).toBe(0);
    expect(console.warn).toHaveBeenLastCalledWith(
      "Commands that load .env.local will use your local values for: GEO_PROVIDER, LOCAL_ONLY_VAR"
    );
  });

  it("does not warn about local fallback when every local name is provided", async () => {
    fs.writeFileSync(join(fixtureDirectory, ".env.local"), "DATABASE_URL=fixture-database\nNODE_ENV=fixture-mode\n");
    expect(await runEnvCommand(argsFor("staging"))).toBe(0);
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining("Commands that load .env.local"));
  });

  it("scans names across buffer boundaries without retaining long values", async () => {
    const fixtureValue = "x".repeat(LONG_FIXTURE_VALUE_LENGTH);
    fs.writeFileSync(join(fixtureDirectory, ".env.local"), `DATABASE_URL=${fixtureValue}\nADMIN_PASSWORD=fixture-password`);
    expect(await runEnvCommand(argsFor("staging"))).toBe(0);
    expect(console.warn).toHaveBeenLastCalledWith(
      "Commands that load .env.local will use your local values for: ADMIN_PASSWORD"
    );
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(fixtureValue);
  });

  it("does not inspect local fallback names for local runs", async () => {
    // A directory would fail the names reader if local runs tried to inspect it.
    fs.mkdirSync(join(fixtureDirectory, ".env.local"));
    listFields(REQUIRED_LOCAL_VARS);
    expect(await runEnvCommand(argsFor("local"))).toBe(0);
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining("Commands that load .env.local"));
  });

  it("fails closed if field listing fails", async () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: 1, signal: null, pid: 0, output: [], stderr: "approval denied", stdout: "",
    });
    expect(await runEnvCommand(argsFor("staging"))).toBe(1);
    expect(spawn).not.toHaveBeenCalled();
    expect(fs.readdirSync(testDirectory)).toEqual([]);
  });

  it("fails closed if the item response is malformed", async () => {
    vi.mocked(spawnSync).mockReturnValue({
      status: 0, signal: null, pid: 0, output: [], stderr: "", stdout: "not json",
    });
    expect(await runEnvCommand(argsFor("staging"))).toBe(1);
    expect(spawn).not.toHaveBeenCalled();
    expect(fs.readdirSync(testDirectory)).toEqual([]);
  });

  it.each(["exit", "error", "throw"])("cleans up on child %s and preserves failure status", async (failure) => {
    vi.mocked(spawn).mockImplementation((_file, argv) => {
      captureTempFile(argv as readonly string[]);
      if (failure === "throw") throw new Error("mock launch failure");
      queueMicrotask(() => failure === "exit"
        ? child.emit("exit", COMMAND_FAILURE_CODE, null)
        : child.emit("error", new Error("mock launch failure")));
      return child;
    });
    expect(await runEnvCommand(argsFor("staging"))).toBe(failure === "exit" ? COMMAND_FAILURE_CODE : 1);
    expect(fs.existsSync(writtenFile!)).toBe(false);
    expect(fs.readdirSync(testDirectory)).toEqual([]);
  });

  it("cleans up if writing the template fails", async () => {
    vi.mocked(fs.writeFileSync).mockImplementationOnce(() => { throw new Error("mock disk failure"); });
    expect(await runEnvCommand(argsFor("staging"))).toBe(1);
    expect(spawn).not.toHaveBeenCalled();
    expect(fs.readdirSync(testDirectory)).toEqual([]);
  });

  it.each(FORWARDED_SIGNALS.flatMap((signal) => [
    { signal, code: 0, exitSignal: null },
    { signal, code: COMMAND_FAILURE_CODE, exitSignal: null },
    { signal, code: null, exitSignal: signal },
    { signal, code: null, exitSignal: "SIGKILL" as const },
  ]))("forwards $signal and waits for child exit ($code, $exitSignal)", async ({ signal, code, exitSignal }) => {
    const on = vi.spyOn(process, "on");
    const exit = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("mock process exit"); });
    vi.mocked(spawn).mockImplementation((_file, argv) => {
      captureTempFile(argv as readonly string[]);
      return child;
    });
    const running = runEnvCommand(argsFor("staging"));
    let settled = false;
    void running.then(() => { settled = true; });
    const handler = on.mock.calls.find(([event]) => event === signal)![1];
    handler();
    await Promise.resolve();
    expect(child.kill).toHaveBeenCalledExactlyOnceWith(signal);
    expect(exit).not.toHaveBeenCalled();
    expect(settled).toBe(false);
    expect(fs.existsSync(writtenFile!)).toBe(true);
    child.emit("exit", code, exitSignal);
    expect(await running).toBe(code ?? SIGNAL_EXIT_CODE_BASE + constants.signals[exitSignal!]);
    expect(fs.existsSync(writtenFile!)).toBe(false);
    expect(process.listeners(signal)).not.toContain(handler);
    expect(fs.readdirSync(testDirectory)).toEqual([]);
  });

  it.each(FORWARDED_SIGNALS)("forces exit and cleans up on a second %s", async (signal) => {
    const on = vi.spyOn(process, "on");
    const exit = vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("mock process exit"); });
    vi.mocked(spawn).mockImplementation((_file, argv) => {
      captureTempFile(argv as readonly string[]);
      return child;
    });
    const running = runEnvCommand(argsFor("staging"));
    const handler = on.mock.calls.find(([event]) => event === signal)![1];
    handler();
    expect(exit).not.toHaveBeenCalled();
    expect(() => handler()).toThrow("mock process exit");
    expect(exit).toHaveBeenCalledExactlyOnceWith(SIGNAL_EXIT_CODE_BASE + constants.signals[signal]);
    expect(child.kill).toHaveBeenCalledExactlyOnceWith(signal);
    expect(fs.existsSync(writtenFile!)).toBe(false);
    child.emit("exit", null, signal);
    expect(await running).toBe(SIGNAL_EXIT_CODE_BASE + constants.signals[signal]);
    expect(process.listeners(signal)).not.toContain(handler);
    expect(fs.readdirSync(testDirectory)).toEqual([]);
  });

  it("cleans up on process exit and removes its lifecycle listeners after completion", async () => {
    const once = vi.spyOn(process, "once");
    const on = vi.spyOn(process, "on");
    vi.mocked(spawn).mockImplementation((_file, argv) => {
      captureTempFile(argv as readonly string[]);
      return child;
    });
    const running = runEnvCommand(argsFor("staging"));
    const exitHandler = once.mock.calls.find(([event]) => event === "exit")![1];
    exitHandler();
    expect(fs.existsSync(writtenFile!)).toBe(false);
    child.emit("exit", 0, null);
    expect(await running).toBe(0);
    expect(process.listeners("exit")).not.toContain(exitHandler);
    for (const [event, handler] of on.mock.calls) {
      if (event === "SIGINT" || event === "SIGTERM" || event === "SIGHUP") {
        expect(process.listeners(event)).not.toContain(handler);
      }
    }
    expect(fs.readdirSync(testDirectory)).toEqual([]);
  });
});
