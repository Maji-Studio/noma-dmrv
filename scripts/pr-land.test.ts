import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts/pr-land.sh");
const EXECUTABLE_MODE = 0o755;
const EXIT_FAILURE = 1;
const EXIT_TEARDOWN_FAILED = 5;
const HEAD = "abcdef1234567890";
const MERGE = "1234567890abcdef";
const QUEUE_EXIT_GRACE_POLLS = 4;
const STALE_REMOVAL_AT = "2026-11-09T12:00:00Z";
const CURRENT_REMOVAL_AT = "2026-11-10T12:00:00Z";
const QUEUE_EXIT_SCENARIOS = ["queue-exit-merged", "queue-exit-removed", "queue-exit-stale", "queue-exit-open"];
const MERGED_PR_READS = { head: 3, checks: 4, "final-head": 6 };
let directory: string;

// Run a script copy with fake gh, git, and worktree.sh. No real teardown or mutations.
const GH_STUB = `#!${process.execPath}
const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
const scenario = process.env.SCENARIO;
const mergedPrReads = ${JSON.stringify(MERGED_PR_READS)};
const queueExitScenarios = ${JSON.stringify(QUEUE_EXIT_SCENARIOS)};
function count(name) {
  const marker = process.env.STUB_DIRECTORY + "/" + name;
  const value = existsSync(marker) ? Number(readFileSync(marker, "utf8")) + 1 : 1;
  writeFileSync(marker, String(value));
  return value;
}
if (args[0] === "api" && args[1] === "graphql" && args.includes("number=1")) {
  const reads = count("queue-reads");
  if (scenario === "head" && process.env.FAIL_QUEUE_REFRESH === "1" && reads > 1) process.exit(1);
  const merged = scenario === "rerun" || (scenario === "queued" && reads > 1)
    || (["head", "checks", "refresh"].includes(scenario) && reads > 1)
    || (scenario === "final-head" && existsSync(process.env.STUB_DIRECTORY + "/pr-reads")
      && Number(readFileSync(process.env.STUB_DIRECTORY + "/pr-reads", "utf8")) >= mergedPrReads[scenario]);
  if (queueExitScenarios.includes(scenario)) {
    const removal = scenario === "queue-exit-stale"
      ? {reason: "failed_checks", createdAt: "${STALE_REMOVAL_AT}"}
      : scenario === "queue-exit-removed" && reads > 2
        ? {reason: "failed_checks", createdAt: "${CURRENT_REMOVAL_AT}"} : null;
    console.log(JSON.stringify({data: {repository: {pullRequest: {
      state: ["queue-exit-merged", "queue-exit-stale"].includes(scenario) && reads > 3 ? "MERGED" : "OPEN",
      isInMergeQueue: reads <= 2,
      mergeCommit: {oid: "${MERGE}"},
      timelineItems: {nodes: removal ? [removal] : []}
    }}}}));
    process.exit(0);
  }
  console.log(JSON.stringify({data: {repository: {pullRequest: {
    state: scenario === "closed" ? "CLOSED" : merged ? "MERGED" : "OPEN",
    isInMergeQueue: scenario === "queued" && !merged,
    mergeCommit: process.env.MERGE_OID ? {oid: process.env.MERGE_OID} : null
  }}}}));
} else if (args[0] === "pr" && args[1] === "view") {
  const reads = count("pr-reads");
  const merged = reads >= mergedPrReads[scenario];
  console.log(JSON.stringify({id: "PR_1", state: merged ? "MERGED" : "OPEN",
    headRefName: "feature/test", headRefOid: "${HEAD}", mergeStateStatus: "CLEAN",
    baseRefName: "staging", isCrossRepository: false}));
} else if (args[0] === "pr" && args[1] === "list") {
  console.log("");
} else if (args[0] === "pr" && args[1] === "checks" && args.includes("--required")) {
  console.log(JSON.stringify([{name: "ci", bucket: "pass", state: "SUCCESS"}]));
} else { console.error("unexpected gh invocation"); process.exit(2); }
`;
const GIT_STUB = `#!${process.execPath}
const args = process.argv.slice(2);
if (args.join(" ") === "rev-parse --path-format=absolute --git-common-dir") {
  console.log(process.env.SYNTHETIC_COMMON_DIR);
} else if (args.join(" ") === "worktree list --porcelain -z") {
  process.stdout.write("worktree " + process.env.STUB_DIRECTORY + "\\0branch refs/heads/feature/test\\0\\0");
} else if (args[0] === "-C" && args[1] === process.env.STUB_DIRECTORY) {
  if (args.slice(2).join(" ") === "rev-parse HEAD") console.log("${HEAD}");
  else if (args.slice(2).join(" ") === "symbolic-ref --quiet --short HEAD") console.log("feature/test");
  else process.exit(2);
} else if (args.join(" ") !== "fetch origin") process.exit(2);
`;
const TEARDOWN_STUB = `#!${process.execPath}
const { writeFileSync } = require("node:fs");
writeFileSync(process.env.STUB_DIRECTORY + "/teardown-call", JSON.stringify({
  cwd: process.cwd(), args: process.argv.slice(2)
}));
process.exit(Number(process.env.TEARDOWN_EXIT));
`;

beforeEach(() => {
  directory = realpathSync(mkdtempSync(join(tmpdir(), "pr-land-test-")));
  writeFileSync(join(directory, "gh"), GH_STUB, { mode: EXECUTABLE_MODE });
  writeFileSync(join(directory, "git"), GIT_STUB, { mode: EXECUTABLE_MODE });
  writeFileSync(join(directory, "sleep"), "#!/bin/bash\nexit 0\n", { mode: EXECUTABLE_MODE });
  const scripts = join(directory, "main", "scripts");
  mkdirSync(join(directory, "main/.git"), { recursive: true });
  mkdirSync(join(scripts, "lib"), { recursive: true });
  cpSync(SCRIPT, join(scripts, "pr-land.sh"));
  cpSync(join(process.cwd(), "scripts/lib/pr-checks.sh"), join(scripts, "lib/pr-checks.sh"));
  writeFileSync(join(scripts, "worktree.sh"), TEARDOWN_STUB, { mode: EXECUTABLE_MODE });
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

function run(args: string[], scenario = "queued", oid = "", teardownExit = 0, failQueueRefresh = false) {
  return spawnSync("/bin/bash", [join(directory, "main/scripts/pr-land.sh"), "1", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      STUB_DIRECTORY: directory,
      SCENARIO: scenario,
      PR_LAND_POLL_INTERVAL_SECONDS: "1",
      MERGE_OID: oid,
      TEARDOWN_EXIT: String(teardownExit),
      FAIL_QUEUE_REFRESH: failQueueRefresh ? "1" : "0",
      SYNTHETIC_COMMON_DIR: join(directory, "main/.git"),
    },
  });
}

describe("pr-land missing merge commit", () => {
  it("returns merged, teardown owed when teardown was requested", () => {
    const result = run(["--teardown", "review-worktree"]);
    expect(result.status).toBe(EXIT_TEARDOWN_FAILED);
    expect(result.stderr).toContain("#1 merged");
    expect(result.stderr).toContain("teardown of review-worktree is still owed");
  });

  it("preserves command failure when teardown was not requested", () => {
    const result = run([]);
    expect(result.status).toBe(EXIT_FAILURE);
    expect(result.stderr).toContain("merge commit oid is unavailable");
  });
});

describe("pr-land merged teardown", () => {
  it.each(["queued", "rerun", "head", "checks", "final-head"])("finishes teardown from %s", (scenario) => {
    const result = run(["--teardown", "review-worktree"], scenario, MERGE);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`#1 MERGED: ${MERGE}`);
    expect(JSON.parse(readFileSync(join(directory, "teardown-call"), "utf8"))).toEqual({
      cwd: join(directory, "main"), args: ["teardown", "review-worktree"],
    });
  });

  it.each(["queued", "rerun", "head", "checks"])("returns exit 5 for missing oid from %s", (scenario) => {
    const result = run(["--teardown", "review-worktree"], scenario);
    expect(result.status).toBe(EXIT_TEARDOWN_FAILED);
    expect(result.stderr).toContain("teardown of review-worktree is still owed");
    expect(existsSync(join(directory, "teardown-call"))).toBe(false);
  });

  it.each(["queued", "rerun"])("returns exit 5 when teardown fails from %s", (scenario) => {
    const result = run(["--teardown", "review-worktree"], scenario, MERGE, EXIT_FAILURE);
    expect(result.status).toBe(EXIT_TEARDOWN_FAILED);
    expect(result.stderr).toContain("teardown of review-worktree failed");
    expect(existsSync(join(directory, "teardown-call"))).toBe(true);
  });

  it.each(["rerun", "refresh"])("previews teardown without running it from %s", (scenario) => {
    const result = run(["--teardown", "review-worktree", "--dry-run"], scenario, MERGE);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("would tear down review-worktree");
    expect(existsSync(join(directory, "teardown-call"))).toBe(false);
  });

  it("previews teardown even when the merged rerun has no oid yet", () => {
    const result = run(["--teardown", "review-worktree", "--dry-run"], "rerun");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("would tear down review-worktree");
    expect(existsSync(join(directory, "teardown-call"))).toBe(false);
  });

  it("returns exit 5 if the oid read fails after a PR read confirms MERGED", () => {
    const result = run(["--teardown", "review-worktree"], "head", MERGE, 0, true);
    expect(result.status).toBe(EXIT_TEARDOWN_FAILED);
    expect(result.stderr).toContain("could not read #1 queue state");
    expect(existsSync(join(directory, "teardown-call"))).toBe(false);
  });

  it.each(["rerun", "closed"])("refuses %s without teardown", (scenario) => {
    expect(run([], scenario, MERGE).status).toBe(EXIT_FAILURE);
    expect(existsSync(join(directory, "teardown-call"))).toBe(false);
  });

  it("refuses closed PRs even with teardown", () => {
    expect(run(["--teardown", "review-worktree"], "closed", MERGE).status).toBe(EXIT_FAILURE);
    expect(existsSync(join(directory, "teardown-call"))).toBe(false);
  });
});

describe("pr-land queue exit grace", () => {
  it.each(["queue-exit-merged", "queue-exit-stale"])("finishes teardown after a delayed merge from %s", (scenario) => {
    const result = run(["--teardown", "review-worktree"], scenario);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`#1 MERGED: ${MERGE}`);
    expect(result.stdout).not.toContain("left the queue unmerged");
    expect(JSON.parse(readFileSync(join(directory, "teardown-call"), "utf8"))).toEqual({
      cwd: join(directory, "main"), args: ["teardown", "review-worktree"],
    });
    expect(Number(readFileSync(join(directory, "queue-reads"), "utf8"))).toBe(4);
  });

  it("fails immediately for a removal created during the watch", () => {
    const result = run(["--teardown", "review-worktree"], "queue-exit-removed");
    expect(result.status, result.stderr).toBe(EXIT_FAILURE);
    expect(result.stdout).toContain(`left the queue unmerged: failed_checks (${CURRENT_REMOVAL_AT})`);
    expect(result.stdout).toContain("Run scripts/ci-failures.sh 1 for head CI");
    expect(Number(readFileSync(join(directory, "queue-reads"), "utf8"))).toBe(3);
    expect(existsSync(join(directory, "teardown-call"))).toBe(false);
  });

  it("fails after the exit grace expires while still open without a removal", () => {
    const result = run(["--teardown", "review-worktree"], "queue-exit-open");
    expect(result.status, result.stderr).toBe(EXIT_FAILURE);
    expect(result.stdout).toContain("left the queue unmerged: unknown (unknown time)");
    // Initial queued read, queued watch poll, grace polls, then the failure poll.
    expect(Number(readFileSync(join(directory, "queue-reads"), "utf8"))).toBe(QUEUE_EXIT_GRACE_POLLS + 3);
    expect(existsSync(join(directory, "teardown-call"))).toBe(false);
  });
});
