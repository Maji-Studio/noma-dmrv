import { spawn } from "node:child_process";
import process from "node:process";

export const DEFAULT_MODELS = ["codex", "opus"];
export const DEFAULT_PRACTICES = ["standards", "spec", "deep-correctness"];
export const DEFAULT_TIMEOUT_MINUTES = 20;
export const DEFAULT_CONCURRENCY = 2;

export function usage() {
  return `
Usage:
  run-pr-review-suite.mjs [--pr <number|url|branch>] [--spec <path>]
    [--models codex,opus] [--practices standards,spec,deep-correctness]
    [--timeout-minutes 20] [--concurrency 2]
    [--artifact-dir <path>] (--publish | --dry-run | --plan)
  run-pr-review-suite.mjs --self-test

Modes:
  --publish   Run reviews and create/update the suite's PR comment.
  --dry-run   Run reviews and write the aggregate report without GitHub writes.
  --plan      Resolve inputs and write prompts without running reviewers.
  --self-test Run offline parser, aggregation, and prompt checks.
`.trim();
}

export function parseArgs(argv) {
  const options = {
    pr: undefined,
    spec: undefined,
    models: [...DEFAULT_MODELS],
    practices: [...DEFAULT_PRACTICES],
    timeoutMinutes: DEFAULT_TIMEOUT_MINUTES,
    concurrency: DEFAULT_CONCURRENCY,
    artifactDir: undefined,
    mode: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      index += 1;
      if (index >= argv.length) {
        throw new Error(`Missing value for ${argument}`);
      }
      return argv[index];
    };

    if (argument === "--pr") options.pr = value();
    else if (argument === "--spec") options.spec = value();
    else if (argument === "--models") options.models = splitList(value());
    else if (argument === "--practices") options.practices = splitList(value());
    else if (argument === "--timeout-minutes") {
      options.timeoutMinutes = positiveInteger(value(), argument);
    } else if (argument === "--concurrency") {
      options.concurrency = positiveInteger(value(), argument);
    } else if (argument === "--artifact-dir") options.artifactDir = value();
    else if (argument === "--publish") {
      options.mode = selectMode(options.mode, "publish");
    } else if (argument === "--dry-run") {
      options.mode = selectMode(options.mode, "dry-run");
    } else if (argument === "--plan") {
      options.mode = selectMode(options.mode, "plan");
    } else if (argument === "--self-test") {
      options.mode = selectMode(options.mode, "self-test");
    } else if (argument === "--help" || argument === "-h") {
      options.mode = "help";
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!options.mode) {
    throw new Error(
      "Choose exactly one mode: --publish, --dry-run, --plan, or --self-test",
    );
  }

  validateSelection("model", options.models, DEFAULT_MODELS);
  validateSelection("practice", options.practices, DEFAULT_PRACTICES);
  return options;
}

function splitList(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function positiveInteger(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function selectMode(current, next) {
  if (current && current !== next) {
    throw new Error("Choose only one execution mode");
  }
  return next;
}

function validateSelection(label, selected, allowed) {
  if (selected.length === 0) {
    throw new Error(`Select at least one ${label}`);
  }
  const unknown = selected.filter((value) => !allowed.includes(value));
  if (unknown.length > 0) {
    throw new Error(`Unknown ${label}(s): ${unknown.join(", ")}`);
  }
}

export function run(command, args, options = {}) {
  const {
    cwd = process.cwd(),
    input,
    timeoutMs,
    allowFailure = false,
    env = process.env,
  } = options;

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let settled = false;
    let terminationTimer;
    let killTimer;

    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      if (terminationTimer) clearTimeout(terminationTimer);
      if (killTimer) clearTimeout(killTimer);
      if (error) rejectPromise(error);
      else resolvePromise(result);
    };

    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      finish(new Error(`Unable to start ${command}: ${error.message}`));
    });
    child.on("close", (code, signal) => {
      const result = {
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };
      if (code === 0 || allowFailure) {
        finish(undefined, result);
      } else {
        const detail =
          result.stderr.trim() || result.stdout.trim() || `exit ${code}`;
        finish(new Error(`${command} failed: ${detail}`));
      }
    });

    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();

    if (timeoutMs) {
      terminationTimer = setTimeout(() => {
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
      }, timeoutMs);
    }
  });
}

export async function requireCommand(command, versionArgs = ["--version"]) {
  const result = await run(command, versionArgs, { allowFailure: true });
  if (result.code !== 0) {
    throw new Error(
      `${command} is required but unavailable: ${result.stderr.trim()}`,
    );
  }
  return (result.stdout || result.stderr).trim().split("\n")[0];
}
