import { deepStrictEqual, equal, match, throws } from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { archiveReport, findingsSummaryLines, projectSlug, reportArchivePath, resolveArchiveRoot } from "./review-archive.mjs";
import { parseArgs, run } from "./review-runtime.mjs";

const LOCAL_ROUND = 2;
const PR_ROUND = 3;
const PR_NUMBER = 42;
const START_LINE = 7;
const WARNING_COUNT = 1;
const EXIT_SUCCESS = 0;
const EXIT_FAILURE = 1;
const EXIT_USAGE = 2;
const SUITE = join(dirname(fileURLToPath(import.meta.url)), "run-pr-review-suite.mjs");

function testPaths(root) {
  const main = "/Users/example/Dropbox/Maji/18 Dark Earth Carbon/noma-dmrv";
  equal(projectSlug(main), "-Users-example-Dropbox-Maji-18-Dark-Earth-Carbon-noma-dmrv");
  equal(projectSlug("/repo_a.b/é"), "-repo-a-b--");
  const report = { branch: "feat/example", mode: "local", round: LOCAL_ROUND };
  equal(reportArchivePath(root, report), join(root, "feat/example/round-2.json"));
  equal(reportArchivePath(root, { ...report, mode: "pr", pr: PR_NUMBER, round: PR_ROUND }),
    join(root, "feat/example/pr-42-round-3.json"));
  for (const branch of ["..", "feat/../escape", "/absolute", "feat//empty", "feat/./dot", "", "feat\\escape", "feat\nline"]) {
    throws(() => reportArchivePath(root, { ...report, branch }), /unsafe branch/);
  }
  for (const round of [0, -1, 1.5, "2", undefined]) {
    throws(() => reportArchivePath(root, { ...report, round }), /positive round/);
  }
  throws(() => reportArchivePath(root, { ...report, mode: "unknown" }), /unknown mode/);
  throws(() => reportArchivePath(root, { ...report, mode: "pr" }), /positive PR/);
}

function testSummary() {
  const finding = { severity: "P2", path: "file.txt", start_line: START_LINE, title: "Lower priority" };
  const report = { reports: [
    { practice: "standards", model: "codex", findings: [finding] },
    { practice: "spec", model: "opus", findings: [
      { ...finding, severity: "P0", title: "Critical" },
      { ...finding, severity: "P3", title: "Minor" },
      { ...finding, severity: "P1", title: "Urgent" },
    ] },
    { practice: "deep-correctness", model: "codex", status: "failed", findings: [] },
  ] };
  const original = JSON.stringify(report);
  deepStrictEqual(findingsSummaryLines(report, "/artifact/report.json", "/archive/round-2.json"), [
    "Findings: /artifact/report.json (.reports[].findings[])",
    "P0 spec/opus file.txt:7 Critical",
    "P1 spec/opus file.txt:7 Urgent",
    "P2 standards/codex file.txt:7 Lower priority",
    "P3 spec/opus file.txt:7 Minor",
    "Archive: /archive/round-2.json",
  ]);
  equal(JSON.stringify(report), original);
  for (const archivePath of [null, undefined]) {
    deepStrictEqual(findingsSummaryLines({ reports: [] }, "report.json", archivePath), [
      "Findings: report.json (.reports[].findings[])", "No findings.", "Archive: skipped or unavailable",
    ]);
  }
}

async function testArchive(root) {
  const source = join(root, "report.json");
  const archive = join(root, "archive");
  const env = { ...process.env, PR_REVIEW_SUITE_ARCHIVE_DIR: archive };
  const warnings = [];
  const options = { env, warn: (message) => warnings.push(message) };
  const report = { mode: "local", branch: "feat/edited", round: LOCAL_ROUND, reports: [
    { practice: "standards", model: "codex", findings: [{ disposition: "fixed", reason: null }] },
  ] };
  const save = (value) => writeFileSync(source, `${JSON.stringify(value, null, 2)}\n`);
  save(report);
  const destination = await archiveReport(source, options);
  equal(destination, reportArchivePath(archive, report));
  equal(readFileSync(destination, "utf8"), readFileSync(source, "utf8"));
  report.reports[0].findings[0] = { disposition: "declined", reason: "Already guarded" };
  save(report);
  equal(await archiveReport(source, options), destination);
  equal(JSON.parse(readFileSync(destination, "utf8")).reports[0].findings[0].reason, "Already guarded");
  equal(await archiveReport(destination, options), destination);
  equal(warnings.length, 0);

  const prReport = { ...report, mode: "pr", pr: PR_NUMBER, round: PR_ROUND, branch: "fix/pr" };
  save(prReport);
  const cli = await run(process.execPath, [SUITE, "--archive", source, "--archive", destination], { env });
  equal(cli.code, EXIT_SUCCESS);
  match(cli.stdout, /pr-42-round-3\.json/);
  match(cli.stdout, /round-2\.json/);
  equal(readFileSync(reportArchivePath(archive, prReport), "utf8"), readFileSync(source, "utf8"));

  const skippedRoot = join(root, "skipped");
  const skipped = await run(process.execPath, [SUITE, "--archive", source], {
    cwd: root, env: { ...env, PR_REVIEW_SUITE_ARCHIVE_DIR: "" },
  });
  equal(skipped.code, EXIT_SUCCESS);
  equal(skipped.stdout, "");
  equal(await archiveReport(source, { ...options, cwd: skippedRoot, env: { PR_REVIEW_SUITE_ARCHIVE_DIR: "" } }), null);
  equal(existsSync(skippedRoot), false);

  // Explicit archive requests fail on errors; review-time copies stay advisory.
  const failure = await run(process.execPath, [SUITE, "--archive", source], {
    env: { ...env, PR_REVIEW_SUITE_ARCHIVE_DIR: source },
    allowFailure: true,
  });
  equal(failure.code, EXIT_FAILURE);
  equal(failure.stderr.trim().split("\n").length, WARNING_COUNT);
  match(failure.stderr, /Warning: could not archive/);
  const missing = join(root, "missing.json");
  const mixed = await run(process.execPath, [SUITE, "--archive", missing, "--archive", source], {
    env, allowFailure: true,
  });
  equal(mixed.code, EXIT_FAILURE);
  match(mixed.stdout, /pr-42-round-3\.json/);
  equal(mixed.stderr.trim().split("\n").length, WARNING_COUNT);
  writeFileSync(source, "invalid json");
  const invalidJson = await run(process.execPath, [SUITE, "--archive", source], {
    env, allowFailure: true,
  });
  equal(invalidJson.code, EXIT_FAILURE);
  match(invalidJson.stderr, /Warning: could not archive/);
  equal(await archiveReport(source, options), undefined);
  equal(warnings.length, WARNING_COUNT);
  warnings.length = 0;
  equal(await archiveReport(source, { ...options, env: {}, gitCommand: async () => { throw new Error("git\nfailed"); } }), undefined);
  equal(warnings.length, WARNING_COUNT);
  equal(warnings[0].split("\n").length, WARNING_COUNT);
}

export async function selfTestReviewArchive() {
  const root = mkdtempSync(join(tmpdir(), "review-archive-selftest-"));
  try {
    testPaths(root);
    testSummary();
    const options = parseArgs(["--archive", "one.json", "--archive", "two.json"]);
    equal(options.mode, "archive");
    deepStrictEqual(options.archive, ["one.json", "two.json"]);
    for (const args of [["--archive"], ["--archive", "one.json", "--publish"], ["--archive", "one.json", "--local"]]) {
      throws(() => parseArgs(args));
    }
    const invalid = await run(process.execPath, [SUITE, "--archive"], { allowFailure: true });
    equal(invalid.code, EXIT_USAGE);
    const main = join(root, "main");
    const gitCommand = async (command, args, options) => {
      equal(command, "git");
      deepStrictEqual(args, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
      equal(options.cwd, join(root, "worktree"));
      return { stdout: `${join(main, ".git")}\n` };
    };
    // Only compute the default home path. Every actual copy uses a temp override.
    equal(await resolveArchiveRoot({ cwd: join(root, "worktree"), env: {}, gitCommand }),
      join(homedir(), ".claude/projects", projectSlug(main), "reviews"));
    equal(await resolveArchiveRoot({ cwd: root, env: { PR_REVIEW_SUITE_ARCHIVE_DIR: "relative" } }), join(root, "relative"));
    await testArchive(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
