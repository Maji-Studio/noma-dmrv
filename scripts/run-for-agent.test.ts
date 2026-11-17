import { spawnSync } from "node:child_process";
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
const EXIT_MISSING = 127;
let directory: string;
let root: string;

beforeEach(() => {
  directory = realpathSync(mkdtempSync(join(tmpdir(), "run-for-agent-test-")));
  root = join(directory, "main checkout");
  mkdirSync(join(root, ".scratchpad"), { recursive: true });
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

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

describe("run-for-agent", () => {
  it("logs live output and ends with the success sentinel", () => {
    prepare("#!/bin/bash\nprintf 'progress\\n'\n");
    const result = run();
    expect(result.status).toBe(EXIT_SUCCESS);
    expect(result.stdout).toBe(log());
    expect(log()).toMatch(/^start=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z name=task\n/);
    expect(log()).toContain("progress\n");
    expect(log()).toMatch(/\nexit=0\n$/);
  });

  it("propagates a failing script status and logs it after unterminated output", () => {
    prepare(`#!/bin/bash\nprintf 'failure'\nexit ${EXIT_FAILURE}\n`);
    const result = run();
    expect(result.status).toBe(EXIT_FAILURE);
    expect(log()).toMatch(/failure\nexit=7\n$/);
  });

  it("captures stdout and stderr in order", () => {
    prepare("#!/bin/bash\nprintf 'first\\n'\nprintf 'error\\n' >&2\nprintf 'last\\n'\n");
    expect(run().status).toBe(EXIT_SUCCESS);
    expect(log()).toContain("first\nerror\nlast\n");
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
    expect(log()).toMatch(/\nexit=127\n$/);
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
    expect(log()).toMatch(/\nexit=0\n$/);
  });
});
