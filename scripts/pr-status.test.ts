import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts/pr-status.sh");
const EXECUTABLE_MODE = 0o755;
const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;
const HEAD = "abcdef1234567890";
const MERGE = "1234567890abcdef";
const MIXED_PASS_COUNT = 4;
const MIXED_PENDING_COUNT = 6;
let directory: string;

// Unexpected gh or git invocations fail. Tests cannot contact GitHub or mutate git.
const GH_STUB = `#!${process.execPath}
const args = process.argv.slice(2);
const number = args[0] === "pr" ? args[2] : args.find(value => value.startsWith("number="))?.slice("number=".length);
if (number === "4") process.exit(1);
if (args[0] === "pr" && args[1] === "view") {
  console.log(JSON.stringify({state: number === "3" ? "MERGED" : number === "6" ? "CLOSED" : "OPEN",
    headRefName: "feature/" + number, headRefOid: "${HEAD}", mergeStateStatus: "BLOCKED",
    mergeCommit: number === "3" ? {oid: "${MERGE}"} : null}));
} else if (args[0] === "pr" && args[1] === "checks" && args.includes("--required")) {
  if (number === "5") { console.log("no required checks reported on branch"); process.exit(1); }
  if (number === "7") { console.log("not json"); process.exit(1); }
  if (number === "10") {
    console.log(JSON.stringify([...Array(${MIXED_PASS_COUNT}).fill("pass"), ...Array(${MIXED_PENDING_COUNT}).fill("pending")].map(bucket => ({name: "ci", bucket, state: "RUNNING"}))));
    process.exit(8);
  }
  console.log(JSON.stringify([{name: "ci", bucket: number === "1" ? "pending" : number === "8" ? "fail" : "pass", state: "RUNNING"}]));
  if (number === "1") process.exit(8);
  if (number === "8") process.exit(1);
} else if (args[0] === "api" && args[1] === "graphql" && !args.includes("--repo") && process.env.GH_REPO === "Maji-Studio/noma-dmrv") {
  if (number === "9") { console.log(JSON.stringify({errors: [{message: "failed"}]})); process.exit(0); }
  console.log(JSON.stringify({data: {repository: {pullRequest: {mergeQueueEntry: number === "2" ? {position: 3, state: "QUEUED"} : null}}}}));
} else { console.error("unexpected gh invocation"); process.exit(2); }
`;
const GIT_STUB = `#!${process.execPath}
const args = process.argv.slice(2);
if (args.join(" ") !== "worktree list --porcelain -z") process.exit(2);
process.stdout.write("worktree /synthetic/remaining-worktree\\0HEAD ${HEAD}\\0branch refs/heads/feature/3\\0\\0");
`;

function run(args: string[]) {
  return spawnSync("/bin/bash", [SCRIPT, ...args], {
    encoding: "utf8", env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
  });
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "pr-status-test-"));
  writeFileSync(join(directory, "gh"), GH_STUB, { mode: EXECUTABLE_MODE });
  writeFileSync(join(directory, "git"), GIT_STUB, { mode: EXECUTABLE_MODE });
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe("pr-status", () => {
  it("reads open PRs with pending checks (gh exits 8)", () => {
    const result = run(["1"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("#1 OPEN abcdef1 checks=pending=1 merge-state=BLOCKED queue=no worktree=none\n");
  });

  it("prints queue position and entry state", () => {
    const result = run(["2"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("#2 OPEN abcdef1 checks=pass=1 merge-state=BLOCKED queue=3/QUEUED worktree=none\n");
  });

  it("shows merged PRs that still owe worktree teardown", () => {
    const result = run(["3"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("#3 MERGED abcdef1 checks=pass=1 merge-state=BLOCKED queue=no worktree=remaining-worktree merge=1234567\n");
  });

  it("continues after an unreadable PR and preserves argument order", () => {
    const result = run(["1", "4", "2"]);
    expect(result.status).toBe(EXIT_FAILURE);
    expect(result.stdout.split("\n")).toEqual([
      "#1 OPEN abcdef1 checks=pending=1 merge-state=BLOCKED queue=no worktree=none",
      "#4 ERROR could not read PR",
      "#2 OPEN abcdef1 checks=pass=1 merge-state=BLOCKED queue=3/QUEUED worktree=none", "",
    ]);
  });

  it("normalizes gh's no-checks message", () => {
    expect(run(["5"]).stdout).toContain("checks=none");
    expect(run(["5"]).status).toBe(0);
  });

  it("separates multiple check buckets with commas in one labeled token", () => {
    const result = run(["10"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("#10 OPEN abcdef1 checks=pass=4,pending=6 merge-state=BLOCKED queue=no worktree=none\n");
  });

  it("reads closed PRs and failed checks (gh exits 1)", () => {
    const result = run(["6", "8"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("#6 CLOSED");
    expect(result.stdout).toContain("#8 OPEN abcdef1 checks=fail=1");
  });

  it.each(["7", "9"])("rejects malformed checks or GraphQL errors for #%s", (number) => {
    const result = run([number]);
    expect(result.status).toBe(EXIT_FAILURE);
    expect(result.stdout).toMatch(new RegExp(`^#${number} ERROR .*\\n$`));
  });

  it.each([[], ["1", "bad"], ["0"]])("rejects invalid arguments %j", (...args) => {
    const result = run(args);
    expect(result.status).toBe(EXIT_USAGE);
    expect(result.stdout).toBe("");
  });

  it("prints help", () => {
    const result = run(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Exit codes:");
  });
});
