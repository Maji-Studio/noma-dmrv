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
export const ENV_RUN_USAGE =
  "Usage: pnpm env:run --1p-env=<local|staging|prod> [--allow-production] -- <command...>";

type Environment = "local" | "staging" | "prod";
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
      if (environment || !["local", "staging", "prod"].includes(value)) {
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

async function runWithTemplate(template: string, command: string[]): Promise<number> {
  const directory = mkdtempSync(join(tmpdir(), "noma-dmrv-env-run-"));
  const tempFile = join(directory, "template.tpl");
  let child: ChildProcess | undefined;
  const cleanup = () => rmSync(directory, { recursive: true, force: true });
  const interrupt = (signal: "SIGINT" | "SIGTERM") => {
    cleanup();
    child?.kill(signal);
    process.exit(signalExitCode(signal));
  };
  const onSigint = () => interrupt("SIGINT");
  const onSigterm = () => interrupt("SIGTERM");

  process.once("exit", cleanup);
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  try {
    // Exclusive creation in a private directory. Only template refs, never resolved secrets.
    writeFileSync(tempFile, template, { encoding: "utf-8", mode: TEMPLATE_MODE, flag: "wx" });
    return await new Promise<number>((resolve, reject) => {
      child = spawn("op", ["run", `--env-file=${tempFile}`, "--", ...command], {
        stdio: "inherit",
      });
      child.once("error", () => reject(new Error("Could not start op run. Check the 1Password CLI installation.")));
      child.once("exit", (code, signal) => resolve(
        code ?? (signal ? signalExitCode(signal) : FAILURE_EXIT_CODE)
      ));
    });
  } finally {
    process.removeListener("exit", cleanup);
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
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

    const templateFile = environment === "local" ? ".env.local.tpl" : ".env.tpl";
    const required = environment === "local" ? REQUIRED_LOCAL_VARS : REQUIRED_DEPLOYED_VARS;
    const template = templateForEnvironment(
      readFileSync(join(process.cwd(), templateFile), "utf-8"), environment
    );
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
    return await runWithTemplate(filtered, command);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    if (error instanceof UsageError) console.error(ENV_RUN_USAGE);
    return FAILURE_EXIT_CODE;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runEnvCommand(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
