import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts/run-for-agent.sh");
const EXECUTABLE_MODE = 0o755;
const READABLE_MODE = 0o644;
const EXIT_SUCCESS = 0;
const EXIT_FAILURE = 7;
const EXIT_USAGE = 2;
const EXIT_LOCKED = 75;
const EXIT_MISSING = 127;
const EXIT_INTERRUPT = 130;
const EXIT_TERMINATE = 143;
const EXIT_HANGUP = 129;
const SCRIPT_SLEEP_SECONDS = 30;
const POLL_INTERVAL_SECONDS = 0.01;
const PROCESS_TIMEOUT_MS = 5_000;
const INTERRUPT_GRACE_MS = 3_000;
const INTERRUPT_MARGIN_MS = 1_500;
const MILLISECONDS_PER_SECOND = 1_000;
const POLL_INTERVAL_MS = POLL_INTERVAL_SECONDS * MILLISECONDS_PER_SECOND;
const READY_MARKER = "script-ready\n";
const SCRIPT_PID_FILE = ".scratchpad/script-pid";
const RECORD_PROCESS = `printf '%s\\n' "$$" > ${SCRIPT_PID_FILE}`;
const started: ReturnType<typeof start>[] = [];
let directory: string;
let root: string;

beforeEach(() => {
  directory = realpathSync(mkdtempSync(join(tmpdir(), "run-for-agent-test-")));
  root = join(directory, "main checkout");
  mkdirSync(join(root, ".scratchpad"), { recursive: true });
});
afterEach(async () => {
  const pidFile = join(root, SCRIPT_PID_FILE);
  if (existsSync(pidFile)) {
    const pid = Number(readFileSync(pidFile, "utf8").trim());
    if (Number.isSafeInteger(pid) && pid > 0) {
      try { process.kill(pid, "SIGKILL"); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
  }
  for (const { child } of started) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }
  await Promise.allSettled(started.map(({ completed }) => completed));
  started.length = 0;
  rmSync(directory, { recursive: true, force: true });
});

function prepare(body: string, mode = EXECUTABLE_MODE) {
  writeFileSync(join(root, ".scratchpad/task.sh"), body, { mode });
}
function run(args = ["task"], cwd = directory) {
  return spawnSync(SCRIPT, args, {
    cwd, encoding: "utf8", env: { ...process.env, RUN_FOR_AGENT_ROOT: root },
  });
}
function log() {
  return readFileSync(join(root, ".scratchpad/runs/task.log"), "utf8");
}
function statusPath() {
  return join(root, ".scratchpad/runs/task.exit");
}
function lockPath() {
  return join(root, ".scratchpad/runs/task.lock");
}
function start(): { child: ChildProcess; completed: Promise<number | null> } {
  const child = spawn(SCRIPT, ["task"], {
    cwd: directory, env: { ...process.env, RUN_FOR_AGENT_ROOT: root },
    timeout: PROCESS_TIMEOUT_MS,
  });
  const completed = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  const runner = { child, completed };
  started.push(runner);
  return runner;
}
async function waitForStatus() {
  const deadline = Date.now() + INTERRUPT_GRACE_MS + INTERRUPT_MARGIN_MS;
  while (!existsSync(statusPath())) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for terminal status");
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}
async function waitForMarker(child: ChildProcess) {
  await new Promise<void>((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => finish(new Error("Timed out waiting for script marker")), PROCESS_TIMEOUT_MS);
    function finish(error?: Error) {
      clearTimeout(timeout);
      child.stdout!.off("data", onData);
      child.off("close", onClose);
      child.off("error", finish);
      if (error) reject(error);
      else resolve();
    }
    function onData(chunk: Buffer) {
      output += chunk.toString();
      if (output.includes(READY_MARKER)) finish();
    }
    function onClose() {
      finish(new Error("Runner closed before script marker"));
    }
    child.stdout!.on("data", onData);
    child.once("close", onClose);
    child.once("error", finish);
  });
}

describe("run-for-agent", () => {
  it("logs live output and ends with the success sentinel", () => {
    prepare("#!/bin/bash\nprintf 'progress\\n'\n");
    const result = run();
    expect(result.status).toBe(EXIT_SUCCESS);
    expect(result.stdout).toBe(log());
    expect(log()).toMatch(/^start=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z name=task\n/);
    expect(log()).toContain("progress\n");
    expect(log().endsWith(`\nexit=${EXIT_SUCCESS}\n`)).toBe(true);
    expect(readFileSync(statusPath(), "utf8")).toBe(`${EXIT_SUCCESS}\n`);
    expect(existsSync(lockPath())).toBe(false);
  });

  it("propagates a failing script status and logs it after unterminated output", () => {
    prepare(`#!/bin/bash\nprintf 'failure'\nexit ${EXIT_FAILURE}\n`);
    const result = run();
    expect(result.status).toBe(EXIT_FAILURE);
    expect(log().endsWith(`failure\nexit=${EXIT_FAILURE}\n`)).toBe(true);
    expect(readFileSync(statusPath(), "utf8")).toBe(`${EXIT_FAILURE}\n`);
  });

  it("removes stale status before script output and ignores a forged log sentinel", async () => {
    mkdirSync(join(root, ".scratchpad/runs"));
    writeFileSync(statusPath(), `${EXIT_FAILURE}\n`);
    prepare(`#!/bin/bash
[ ! -e .scratchpad/runs/task.exit ] || exit ${EXIT_FAILURE}
printf 'exit=${EXIT_SUCCESS}\\n${READY_MARKER}'
while [ ! -f .scratchpad/release ]; do sleep ${POLL_INTERVAL_SECONDS}; done
`);
    const { child, completed } = start();
    try {
      await waitForMarker(child);
      expect(log()).toContain(`exit=${EXIT_SUCCESS}\n`);
      expect(existsSync(statusPath())).toBe(false);
      writeFileSync(join(root, ".scratchpad/release"), "");
      expect(await completed).toBe(EXIT_SUCCESS);
      expect(readFileSync(statusPath(), "utf8")).toBe(`${EXIT_SUCCESS}\n`);
    } finally {
      if (child.exitCode === null) child.kill("SIGTERM");
      await completed;
    }
  });

  it("refuses overlapping runs without touching the first run's log or status", async () => {
    prepare(`#!/bin/bash
printf '${READY_MARKER}'
while [ ! -f .scratchpad/release ]; do sleep ${POLL_INTERVAL_SECONDS}; done
printf 'first run finished\\n'
exit ${EXIT_FAILURE}
`);
    const { child, completed } = start();
    await waitForMarker(child);
    const firstLog = log();
    expect(readFileSync(join(lockPath(), "pid"), "utf8")).toBe(`${child.pid}\n`);
    expect(existsSync(statusPath())).toBe(false);
    const refused = run();
    expect(refused.status).toBe(EXIT_LOCKED);
    expect(refused.stderr).toContain("already running");
    expect(log()).toBe(firstLog);
    expect(existsSync(statusPath())).toBe(false);
    // Also prove refusal preserves an existing status, rather than removing it.
    writeFileSync(statusPath(), `${EXIT_SUCCESS}\n`);
    expect(run().status).toBe(EXIT_LOCKED);
    expect(readFileSync(statusPath(), "utf8")).toBe(`${EXIT_SUCCESS}\n`);
    expect(log()).toBe(firstLog);
    writeFileSync(join(root, ".scratchpad/release"), "");
    expect(await completed).toBe(EXIT_FAILURE);
    expect(log()).toBe(`${firstLog}first run finished\n\nexit=${EXIT_FAILURE}\n`);
    expect(readFileSync(statusPath(), "utf8")).toBe(`${EXIT_FAILURE}\n`);
    expect(existsSync(lockPath())).toBe(false);
  });

  it("takes over a lock whose runner PID is dead", () => {
    prepare("#!/bin/bash\nprintf 'reclaimed\\n'\n");
    const previous = run();
    expect(previous.status).toBe(EXIT_SUCCESS);
    expect(() => process.kill(previous.pid, 0)).toThrowError(expect.objectContaining({ code: "ESRCH" }));
    mkdirSync(lockPath());
    writeFileSync(join(lockPath(), "pid"), `${previous.pid}\n`);
    expect(run().status).toBe(EXIT_SUCCESS);
    expect(log()).toContain("reclaimed\n");
    expect(readFileSync(statusPath(), "utf8")).toBe(`${EXIT_SUCCESS}\n`);
    expect(existsSync(lockPath())).toBe(false);
  });

  it.each([
    ["SIGINT", EXIT_INTERRUPT],
    ["SIGTERM", EXIT_TERMINATE],
    ["SIGHUP", EXIT_HANGUP],
  ] as const)("publishes exactly one terminal status after %s", async (signal, code) => {
    prepare(`#!/bin/bash\nprintf '${READY_MARKER}'\nsleep ${SCRIPT_SLEEP_SECONDS}\n`);
    const { child, completed } = start();
    try {
      await waitForMarker(child);
      expect(existsSync(statusPath())).toBe(false);
      expect(child.kill(signal)).toBe(true);
      expect(await completed).toBe(code);
      expect(existsSync(lockPath())).toBe(false);
      expect(readFileSync(statusPath(), "utf8")).toBe(`${code}\n`);
      expect(log().endsWith(`\nexit=${code}\n`)).toBe(true);
      expect(log().split("\n").filter((line) => line.startsWith("exit="))).toEqual([`exit=${code}`]);
    } finally {
      if (child.exitCode === null) child.kill("SIGTERM");
      await completed;
    }
  });

  it("publishes hangup status with broken stdout", async () => {
    prepare(`#!/bin/bash
${RECORD_PROCESS}
printf '${READY_MARKER}'
exec sleep ${SCRIPT_SLEEP_SECONDS}
`);
    const { child, completed } = start();
    await waitForMarker(child);
    child.stdout!.destroy();
    expect(child.kill("SIGHUP")).toBe(true);
    await waitForStatus();
    expect(readFileSync(statusPath(), "utf8")).toBe(`${EXIT_HANGUP}\n`);
    expect(log().endsWith(`\nexit=${EXIT_HANGUP}\n`)).toBe(true);
    expect(await completed).toBe(EXIT_HANGUP);
  });

  it("kills a TERM-ignoring script before publishing interrupt status", async () => {
    prepare(`#!/bin/bash
trap '' TERM
${RECORD_PROCESS}
printf '${READY_MARKER}'
while :; do :; done
`);
    const { child, completed } = start();
    await waitForMarker(child);
    const scriptPid = Number(readFileSync(join(root, SCRIPT_PID_FILE), "utf8").trim());
    expect(child.kill("SIGINT")).toBe(true);
    await waitForStatus();
    expect(() => process.kill(scriptPid, 0)).toThrowError(expect.objectContaining({ code: "ESRCH" }));
    expect(readFileSync(statusPath(), "utf8")).toBe(`${EXIT_INTERRUPT}\n`);
    expect(log().endsWith(`\nexit=${EXIT_INTERRUPT}\n`)).toBe(true);
    expect(await completed).toBe(EXIT_INTERRUPT);
  });

  it("captures stdout and stderr in order", () => {
    prepare("#!/bin/bash\nprintf 'first\\n'\nprintf 'error\\n' >&2\nprintf 'last\\n'\n");
    expect(run().status).toBe(EXIT_SUCCESS);
    expect(log()).toContain("first\nerror\nlast\n");
  });

  it("inherits ignored terminal job-control signals in the prepared script", async () => {
    prepare("#!/bin/bash\nkill -s TTIN \"$$\"\nkill -s TTOU \"$$\"\nprintf 'signals survived\\n'\n");
    const { completed } = start();
    expect(await completed).toBe(EXIT_SUCCESS);
    expect(log()).toContain("signals survived\n");
  });

  it("passes arguments through without splitting or expansion", () => {
    prepare('#!/bin/bash\nprintf "<%s>\\n" "$@"\n');
    expect(run(["task", "two words", "*.txt", ""]).status).toBe(EXIT_SUCCESS);
    expect(log()).toContain("<two words>\n<*.txt>\n<>\n");
  });

  it("runs in the main root from an unrelated cwd", () => {
    prepare("#!/bin/bash\npwd\n");
    expect(run().status).toBe(EXIT_SUCCESS);
    expect(log()).toContain(`\n${root}\n`);
  });

  it("finds the main checkout from the worktree script path", () => {
    const scripts = join(directory, "worktree/scripts");
    const bin = join(directory, "bin");
    mkdirSync(scripts, { recursive: true });
    mkdirSync(bin);
    cpSync(SCRIPT, join(scripts, "run-for-agent.sh"));
    writeFileSync(join(bin, "git"), `#!/bin/bash
[ "$1" = -C ] && [ "$2" = "${scripts}" ] || exit ${EXIT_USAGE}
shift 2
[ "$*" = 'rev-parse --path-format=absolute --git-common-dir' ] || exit ${EXIT_USAGE}
printf '%s\\n' '${root}/.git'
`, { mode: EXECUTABLE_MODE });
    mkdirSync(join(root, ".git"));
    prepare("#!/bin/bash\npwd\n");
    const result = spawnSync(join(scripts, "run-for-agent.sh"), ["task"], {
      cwd: directory, encoding: "utf8",
      env: { ...process.env, RUN_FOR_AGENT_ROOT: "", PATH: `${bin}:${process.env.PATH}` },
    });
    expect(result.status).toBe(EXIT_SUCCESS);
    expect(log()).toContain(`\n${root}\n`);
  });

  it("logs a missing script as exit 127", () => {
    const result = run();
    expect(result.status).toBe(EXIT_MISSING);
    expect(result.stderr).toContain("prepared script not found");
    expect(log().endsWith(`\nexit=${EXIT_MISSING}\n`)).toBe(true);
    expect(readFileSync(statusPath(), "utf8")).toBe(`${EXIT_MISSING}\n`);
    expect(existsSync(lockPath())).toBe(false);
  });

  it.each(["", "..", "../task", "a/b", "a b", "-task"])("refuses invalid name %j without creating logs", (name) => {
    const result = run([name]);
    expect(result.status).toBe(EXIT_USAGE);
    expect(result.stderr).toContain("Usage:");
    expect(existsSync(join(root, ".scratchpad/runs"))).toBe(false);
  });

  it.each(["--help", "-h"])("prints help for %s", (flag) => {
    const result = run([flag]);
    expect(result.status).toBe(EXIT_SUCCESS);
    expect(result.stdout).toContain("Usage:");
  });

  it("requires a name", () => {
    const result = run([]);
    expect(result.status).toBe(EXIT_USAGE);
    expect(result.stderr).toContain("Usage:");
  });

  it("uses a non-executable script's shebang interpreter and flags", () => {
    prepare("#!/bin/sh -e\nprintf 'interpreter\\n'\nfalse\nprintf 'unreachable\\n'\n", READABLE_MODE);
    expect(run().status).not.toBe(EXIT_SUCCESS);
    expect(log()).toContain("interpreter\n");
    expect(log()).not.toContain("unreachable");
  });

  it("falls back to bash without a shebang", () => {
    prepare("[[ -n bash ]] && printf 'fallback\\n'\n", READABLE_MODE);
    expect(run().status).toBe(EXIT_SUCCESS);
    expect(log()).toContain("fallback\n");
  });

  it("truncates the previous log on a second run", () => {
    prepare("#!/bin/bash\nprintf 'old output\\n'\n");
    expect(run().status).toBe(EXIT_SUCCESS);
    prepare("#!/bin/bash\nprintf 'new output\\n'\n");
    expect(run().status).toBe(EXIT_SUCCESS);
    expect(log()).not.toContain("old output");
    expect(log()).toContain("new output\n");
    expect(log().endsWith(`\nexit=${EXIT_SUCCESS}\n`)).toBe(true);
  });
});
