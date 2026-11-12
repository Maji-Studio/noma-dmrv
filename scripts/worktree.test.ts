import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const EXECUTABLE_MODE = 0o755;
let directory: string;
const REPO = process.cwd();

beforeEach(() => {
  mkdirSync(join(REPO, ".cache"), { recursive: true });
  directory = mkdtempSync(join(REPO, ".cache/worktree-status-"));
  mkdirSync(join(directory, "scripts/lib"), { recursive: true });
  mkdirSync(join(directory, ".git"));
  copyFileSync(join(REPO, "scripts/worktree.sh"), join(directory, "scripts/worktree.sh"));
  copyFileSync(join(REPO, "scripts/lib/worktree-github.sh"), join(directory, "scripts/lib/worktree-github.sh"));
  for (const name of ["alpha", "beta", "unknown"]) {
    const owner = join(directory, ".claude/worktrees/.owners", name);
    mkdirSync(owner, { recursive: true });
    writeFileSync(join(owner, "owner"), `WT_BRANCH=chore/${name}\nWT_PORT=3101\nWT_PATH='${directory}/${name}'\nOWNER_SESSION=fixture\nWT_DEV_DB=fixture_dev\nWT_TEST_DB=fixture_test\nWT_DBS_CREATED=''\n`);
  }
  const stubs: Record<string, string> = {
    git: `if [ "$1" = rev-parse ]; then printf '%s/.git\\n' "$FIXTURE"; elif [ "$3 $4 $5" = 'worktree list --porcelain' ]; then :; else exit 2; fi`,
    docker: "exit 0", // No Docker/SQL command ever executes.
    lsof: "exit 1",
    gh: `printf '%s\\n' "$*" >> "$FIXTURE/gh-calls"
if [ "$FAIL_GH" = 1 ]; then exit 1; fi
cat "$FIXTURE/response.json"
if [ "$FAIL_GH" = 2 ]; then exit 1; fi`,
  };
  for (const [name, body] of Object.entries(stubs)) writeFileSync(join(directory, name), `#!/bin/bash\n${body}\n`, { mode: EXECUTABLE_MODE });
  const branch = (name: string, prs: object[]) => ({ nodes: prs.map(pr => ({ ...pr, headRefName: name })) });
  writeFileSync(join(directory, "response.json"), JSON.stringify({ data: {
    branch0: branch("chore/alpha", [{ number: 10, state: "OPEN", createdAt: "2026-01-01", closingIssuesReferences: { nodes: [{ number: 42 }, { number: 43 }] } }]),
    branch1: branch("chore/beta", []), branch2: branch("chore/unknown", []),
    repository: { issues: { nodes: [{ number: 99, linkedBranches: { nodes: [{ ref: { name: "chore/beta" } }] } }], pageInfo: { hasNextPage: false } },
  } } }));
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

function run(fail: boolean | 2 = false) {
  return spawnSync("/bin/bash", [join(directory, "scripts/worktree.sh"), "status"], {
    encoding: "utf8", env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, FIXTURE: directory, FAIL_GH: fail === 2 ? "2" : fail ? "1" : "0" },
  });
}

describe("worktree status", () => {
  it("batches PRs and linked issues, preferring closing references", () => {
    const result = run();
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toMatch(/PR\s+ISSUE\s+BRANCH/);
    expect(result.stdout).toMatch(/alpha\s+3101\s+down\s+#10 OPEN\s+#42,#43\s+chore\/alpha/);
    expect(result.stdout).toMatch(/beta\s+3101\s+down\s+no PR\s+#99\s+chore\/beta/);
    expect(result.stdout).toMatch(/unknown\s+3101\s+down\s+no PR\s+-\s+chore\/unknown/);
    const calls = readFileSync(join(directory, "gh-calls"), "utf8").trim().split("\n");
    // The GraphQL query spans lines; count invocations rather than query lines.
    expect(calls.filter(line => line.startsWith("api graphql"))).toHaveLength(1);
    expect(calls.join("\n")).toContain("--paginate");
    expect(calls.join("\n")).toContain("search(type:ISSUE");
    expect(calls.join("\n")).not.toContain("ref(qualifiedName");
  });

  it("finds linked branches on later issue pages and the newest PR after remote branch deletion", () => {
    const responseFile = join(directory, "response.json");
    const page = JSON.parse(readFileSync(responseFile, "utf8"));
    page.data.branch0.nodes.push({ number: 20, state: "MERGED", createdAt: "2026-02-01", headRefName: "chore/alpha", closingIssuesReferences: { nodes: [] } });
    page.data.repository.issues = { nodes: [], pageInfo: { hasNextPage: true, endCursor: "next" } };
    const next = { data: { repository: { issues: { nodes: [{ number: 88, linkedBranches: { nodes: [{ ref: { name: "chore/alpha" } }] } }], pageInfo: { hasNextPage: false } } } } };
    writeFileSync(responseFile, JSON.stringify(page) + "\n" + JSON.stringify(next));
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/alpha\s+3101\s+down\s+#20 MERGED\s+#88/);
  });

  it("reports unknown GitHub state for GraphQL errors without losing local rows", () => {
    writeFileSync(join(directory, "response.json"), JSON.stringify({ errors: [{ message: "unavailable" }] }));
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/alpha\s+3101\s+down\s+\?\s+-/);
  });

  it("still prints every row when GitHub is unavailable", () => {
    const result = run(true);
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toMatch(/alpha\s+3101\s+down\s+\?\s+-/);
    expect(result.stdout).toContain("chore/beta");
  });

  it("ignores a partial page when gh fails after printing one", () => {
    const result = run(2);
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toMatch(/alpha\s+3101\s+down\s+\?\s+-/);
    expect(result.stdout).not.toMatch(/#42/);
  });
});
