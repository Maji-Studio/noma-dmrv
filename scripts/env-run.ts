/** Run one command with a filtered 1Password env template, without injecting a file. */
import { spawn, type ChildProcess } from "child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { constants, tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import {
  REQUIRED_DEPLOYED_VARS,
  REQUIRED_LOCAL_VARS,
  fetchItemFieldNames,
  filterTemplateToItem,
  itemNameForEnvironment,
  templateForEnvironment,
  warnSkippedOptionalVars,
} from "./env-tpl-utils";

const TEMPLATE_MODE = 0o600;
const SIGNAL_EXIT_CODE_BASE = 128;
const FAILURE_EXIT_CODE = 1;
const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
const ENVIRONMENTS = {
  local: { templateFile: ".env.local.tpl", required: REQUIRED_LOCAL_VARS, nodeEnvOverride: null },
  staging: { templateFile: ".env.tpl", required: REQUIRED_DEPLOYED_VARS, nodeEnvOverride: null },
  prod: { templateFile: ".env.tpl", required: REQUIRED_DEPLOYED_VARS, nodeEnvOverride: "production" },
} as const;
export const ENV_RUN_USAGE =
  `Usage: pnpm env:run --1p-env=<${Object.keys(ENVIRONMENTS).join("|")}> [--allow-production] -- <command...>`;

type Environment = keyof typeof ENVIRONMENTS;
interface EnvRunArgs {
  environment: Environment;
  allowProduction: boolean;
  command: string[];
}

class UsageError extends Error {}

export function parseEnvRunArgs(args: string[]): EnvRunArgs {
  const separator = args.indexOf("--");
  if (separator < 0 || !args[separator + 1]?.trim()) {
    throw new UsageError("Provide -- followed by a command.");
  }

  let environment: Environment | undefined;
  let allowProduction = false;
  for (const arg of args.slice(0, separator)) {
    if (arg.startsWith("--1p-env=")) {
      const value = arg.slice("--1p-env=".length);
      if (environment || !Object.hasOwn(ENVIRONMENTS, value)) {
        throw new UsageError("Provide one --1p-env with local, staging, or prod.");
      }
      environment = value as Environment;
    } else if (arg === "--allow-production") {
      allowProduction = true;
    } else {
      throw new UsageError("Unknown wrapper flag.");
    }
  }
  if (!environment) throw new UsageError("Provide --1p-env=local, staging, or prod.");
  return { environment, allowProduction, command: args.slice(separator + 1) };
}

function signalExitCode(signal: NodeJS.Signals): number {
  return SIGNAL_EXIT_CODE_BASE + constants.signals[signal];
}

function overrideNodeEnv(template: string, nodeEnv: string | null): string {
  if (nodeEnv === null) return template;
  const assignment = `NODE_ENV=${nodeEnv}`;
  const declaration = /^[ \t]*NODE_ENV=.*$/gm;
  return declaration.test(template)
    ? template.replace(declaration, assignment)
    : `${template}${template.endsWith("\n") ? "" : "\n"}${assignment}\n`;
}

/** Empty skipped names block both inherited shell values and later dotenv loading. */
function templateForRun(filtered: string, skipped: string[]): string {
  return [filtered, ...skipped.map((name) => `${name}=`)].join("\n");
}

function inheritedEnvForTemplate(template: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const [, name] of template.matchAll(/^[ \t]*([A-Z_][A-Z0-9_]*)=/gm)) {
    delete env[name];
  }
  return env;
}

async function runWithTemplate(template: string, command: string[]): Promise<number> {
  const directory = mkdtempSync(join(tmpdir(), "noma-dmrv-env-run-"));
  const tempFile = join(directory, "template.tpl");
  let child: ChildProcess | undefined;
  const cleanup = () => rmSync(directory, { recursive: true, force: true });
  const receivedSignals = new Set<NodeJS.Signals>();
  const interrupt = (signal: NodeJS.Signals) => {
    if (receivedSignals.has(signal)) {
      cleanup();
      process.exit(signalExitCode(signal));
    }
    receivedSignals.add(signal);
    child?.kill(signal);
  };
  const signalHandlers = FORWARDED_SIGNALS.map((signal) => [signal, () => interrupt(signal)] as const);

  process.once("exit", cleanup);
  for (const [signal, handler] of signalHandlers) process.on(signal, handler);
  try {
    // Exclusive creation in a private directory. Only template refs, never resolved secrets.
    writeFileSync(tempFile, template, { encoding: "utf-8", mode: TEMPLATE_MODE, flag: "wx" });
    return await new Promise<number>((resolve, reject) => {
      child = spawn("op", ["run", `--env-file=${tempFile}`, "--", ...command], {
        stdio: "inherit",
        env: inheritedEnvForTemplate(template),
      });
      child.once("error", () => reject(new Error("Could not start op run. Check the 1Password CLI installation.")));
      child.once("exit", (code, signal) => resolve(
        code ?? (signal ? signalExitCode(signal) : FAILURE_EXIT_CODE)
      ));
    });
  } finally {
    process.removeListener("exit", cleanup);
    for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
    cleanup();
  }
}

/** Return an exit code so importing this module never starts a command. */
export async function runEnvCommand(args: string[]): Promise<number> {
  try {
    const { environment, allowProduction, command } = parseEnvRunArgs(args);
    if (environment === "prod" && !allowProduction) {
      throw new Error("Production commands can change live data. Pass --allow-production to continue.");
    }

    const { templateFile, required, nodeEnvOverride } = ENVIRONMENTS[environment];
    const template = overrideNodeEnv(templateForEnvironment(
      readFileSync(join(process.cwd(), templateFile), "utf-8"), environment
    ), nodeEnvOverride);
    const { filtered, skipped, missingRequired } = filterTemplateToItem(
      template, fetchItemFieldNames(environment), required
    );
    const itemName = itemNameForEnvironment(environment);
    if (missingRequired.length > 0) {
      throw new Error(
        `Required field(s) missing from 1Password item "${itemName}": ${missingRequired.join(", ")}. ` +
        "Add them to the item before running the command."
      );
    }
    warnSkippedOptionalVars(skipped, itemName);
    return await runWithTemplate(templateForRun(filtered, skipped), command);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    if (error instanceof UsageError) console.error(ENV_RUN_USAGE);
    return FAILURE_EXIT_CODE;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runEnvCommand(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
