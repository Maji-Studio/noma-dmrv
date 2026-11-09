import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts/pr-land.sh");
const EXECUTABLE_MODE = 0o755;
const EXIT_FAILURE = 1;
const EXIT_TEARDOWN_FAILED = 5;
let directory: string;

// Only the queue watch and repository-location lookup are allowed. No mutations.
const GH_STUB = `#!${process.execPath}
const { existsSync, writeFileSync } = require("node:fs");
const args = process.argv.slice(2);
if (args[0] !== "api" || args[1] !== "graphql" || !args.includes("number=1")) process.exit(2);
const marker = process.env.QUEUE_MARKER;
const merged = existsSync(marker);
writeFileSync(marker, "read");
console.log(JSON.stringify({data: {repository: {pullRequest: {
  state: merged ? "MERGED" : "OPEN", isInMergeQueue: !merged, mergeCommit: null
}}}}));
`;
const GIT_STUB = `#!${process.execPath}
if (process.argv.slice(2).join(" ") !== "rev-parse --path-format=absolute --git-common-dir") process.exit(2);
console.log(process.env.SYNTHETIC_COMMON_DIR);
`;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "pr-land-test-"));
  writeFileSync(join(directory, "gh"), GH_STUB, { mode: EXECUTABLE_MODE });
  writeFileSync(join(directory, "git"), GIT_STUB, { mode: EXECUTABLE_MODE });
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

function run(args: string[]) {
  return spawnSync("/bin/bash", [SCRIPT, "1", ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      QUEUE_MARKER: join(directory, "queue-read"),
      SYNTHETIC_COMMON_DIR: join(process.cwd(), "scripts"),
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
