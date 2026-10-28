import { spawn } from "node:child_process";
import process from "node:process";

import { MODEL_PROFILES } from "./review-models.mjs";

export const DEFAULT_MODELS = ["codex", "opus"];
export const DEFAULT_PRACTICES = ["standards", "spec", "deep-correctness", "design"];
export const DEFAULT_TIMEOUT_MINUTES = 20;
export const DEFAULT_CONCURRENCY = 2;
export const DEFAULT_COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
const SIGKILL_GRACE_MS = 5000;
const UI_FILE_EXTENSIONS = [".tsx", ".jsx", ".css", ".scss", ".html", ".vue", ".svelte"];
const UI_TEST_FILENAME_PATTERN = /\.(?:test|spec)\./;
const UI_TEST_PATH_PATTERN = /(?:^|\/)(?:e2e|tests|__tests__|__mocks__)(?:\/|$)/;

export function usage() {
  return `
Usage:
  run-pr-review-suite.mjs [--pr <number|url|branch> | --local [--base <branch>]]
    [--spec <path> | --issue <number>] [--prior <report.json>]... [--profile full|light]
    [--models codex,opus] [--practices standards,spec,deep-correctness,design]
    [--timeout-minutes 20] [--concurrency 2]
    [--artifact-dir <path>] (--publish | --dry-run | --plan)
  run-pr-review-suite.mjs --self-test

Modes:
  --publish   Run reviews and create/update the suite's PR comment.
  --dry-run   Run reviews and write the aggregate report without GitHub writes.
  --plan      Resolve inputs and write prompts without running reviewers.
  --self-test Run offline parser, aggregation, and prompt checks.

Options:
  --local     Review committed HEAD without a PR; requires --dry-run or --plan.
  --base      Local base branch (default staging); fetch origin, then use merge-base.
  --issue     Explicit issue spec source; cannot be combined with --spec.
  --prior     Earlier report.json with fixed/declined findings; repeat in round order.
  --profile   full (default) or light, with cheaper Codex and lower Opus effort.
`.trim();
}

export function parseArgs(argv) {
  const options = {
    pr: undefined,
    spec: undefined,
    local: false,
    base: "staging",
    issue: undefined,
    prior: [],
    profile: "full",
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
    else if (argument === "--local") options.local = true;
    else if (argument === "--base") options.base = value();
    else if (argument === "--issue") {
      options.issue = value();
      if (!/^[1-9]\d*$/.test(options.issue)) throw new Error("--issue must be a positive issue number");
    } else if (argument === "--prior") options.prior.push(value());
    else if (argument === "--profile") options.profile = value();
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

  if (options.local && options.pr) throw new Error("--local cannot be combined with --pr");
  if (options.local && !["dry-run", "plan"].includes(options.mode)) {
    throw new Error("--local requires --dry-run or --plan and cannot be used with --publish");
  }
  if (!options.local && argv.includes("--base")) throw new Error("--base is only meaningful with --local");
  if (options.issue && options.spec) throw new Error("--issue cannot be combined with --spec");
  if (!Object.hasOwn(MODEL_PROFILES, options.profile)) throw new Error(`Unknown --profile: ${options.profile}; choose full or light`);
  if (!options.base || options.base.startsWith("-")) throw new Error("--base must be a branch name");

  validateSelection("model", options.models, DEFAULT_MODELS);
  validateSelection("practice", options.practices, DEFAULT_PRACTICES);
  return options;
}

export function selectPractices({ practices, spec, changedFiles, basePracticeReference }) {
  const skippedPractices = new Map();
  const hasUiChanges = changedFiles.some((path) =>
    UI_FILE_EXTENSIONS.some((extension) => path.endsWith(extension)) &&
    !UI_TEST_FILENAME_PATTERN.test(path.split("/").at(-1)) &&
    !UI_TEST_PATH_PATTERN.test(path),
  );
  for (const practice of practices) {
    if (practice === "spec" && !spec) {
      skippedPractices.set(practice, "No spec available");
    } else if (practice === "design") {
      if (!hasUiChanges) {
        skippedPractices.set(practice, "No UI files changed");
      } else if (!/^## Design\r?$/m.test(basePracticeReference || "")) {
        skippedPractices.set(practice, "No Design practice in the base branch");
      }
    }
  }
  return {
    practices: practices.filter((practice) => !skippedPractices.has(practice)),
    skippedPractices,
  };
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
  const repeated = [
    ...new Set(
      selected.filter((value, index) => selected.indexOf(value) !== index),
    ),
  ];
  if (repeated.length > 0) {
    throw new Error(
      `Duplicate ${label}(s): ${repeated.join(", ")}. Each ${label} may be selected once.`,
    );
  }
}

export function run(command, args, options = {}) {
  const {
    cwd = process.cwd(),
    input,
    timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
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
    let timedOut = false;
    let stdinError;
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
    // A child that exits before draining stdin raises EPIPE on this stream. Without a
    // listener Node rethrows it as an uncaught exception, which skips every caller's
    // try/catch and any worktree cleanup. EPIPE itself is not settled here: the close
    // event carries the child's real exit status, which is the more useful error.
    child.stdin.on("error", (error) => {
      stdinError = error;
      if (error.code !== "EPIPE") {
        finish(
          new Error(`Unable to send input to ${command}: ${error.message}`),
        );
      }
    });
    child.on("close", (code, signal) => {
      const result = {
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };
      if (code === 0 || allowFailure) {
        finish(undefined, { ...result, timedOut });
      } else {
        const detail = timedOut
          ? `timed out after ${Math.round(timeoutMs / 1000)}s and was terminated`
          : result.stderr.trim() || result.stdout.trim() || `exit ${code}`;
        const inputNote = stdinError
          ? ` (input stream error: ${stdinError.code || stdinError.message})`
          : "";
        finish(new Error(`${command} failed: ${detail}${inputNote}`));
      }
    });

    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();

    if (timeoutMs) {
      terminationTimer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => child.kill("SIGKILL"), SIGKILL_GRACE_MS);
      }, timeoutMs);
    }
  });
}

export function globToRegExp(glob) {
  let expression = "^";
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index];
    const next = glob[index + 1];
    if (character === "*" && next === "*") {
      // "**/" spans zero or more directories, so it must be able to consume the
      // trailing slash. Emitting ".*" and leaving the slash literal forced at least
      // one directory and made "src/**/*x*" unable to match "src/x.ts".
      if (glob[index + 2] === "/") {
        expression += "(?:.*/)?";
        index += 2;
      } else {
        expression += ".*";
        index += 1;
      }
    } else if (character === "*") {
      expression += "[^/]*";
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  return new RegExp(`${expression}$`);
}

export function matchesScope(path, scope) {
  return globToRegExp(scope).test(path);
}

export function truncateForComment(body, limit, artifactDir) {
  if (body.length <= limit) return body;
  const notice = `\n\n_Report truncated to fit the GitHub comment limit. Full report: ${artifactDir}_\n`;
  return `${body.slice(0, limit - notice.length)}${notice}`;
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
