#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { selfTestDesignContext, selfTestDesignRuntime } from "./review-context-self-test.mjs";
import {
  materializeGlobalDesignSkill,
  selectDesignContextPaths,
} from "./review-context.mjs";
import {
  createPrompt,
  extractPracticeDefinition,
  MAX_FINDINGS,
  parseReviewOutput,
  REVIEW_SCHEMA,
} from "./review-prompt.mjs";
import {
  aggregateReport,
  buildReportJson,
  COMMENT_MARKER,
  displayModel,
  displayPractice,
} from "./review-report.mjs";
import {
  DEFAULT_PRACTICES,
  matchesScope,
  parseArgs,
  requireCommand,
  run,
  selectPractices,
  truncateForComment,
  usage,
} from "./review-runtime.mjs";
import { modelSettings, profileModels } from "./review-models.mjs";
import { loadPriors } from "./review-prior.mjs";
import { selfTestLocalReview } from "./review-local-self-test.mjs";
import { discoverSpec } from "./review-spec.mjs";
import { resolveTarget, verifyLocalHead, verifyRemoteHead } from "./review-target.mjs";

const MAX_DIFF_CHARS = 500_000;
const REPORT_FILENAME = "report.json";
// Generated payloads the models read nothing useful from: one drizzle snapshot
// alone (~390k chars) used to push a routine schema PR past MAX_DIFF_CHARS.
// They stay in the changed-file list, and the report names what was left out.
// openapi/v1.json is generated from the route schemas the diff already shows.
// SQL migrations, lockfiles and the generated Certify types (the registry
// contract) stay in.
const GENERATED_PAYLOAD_GLOBS = [
  "drizzle/meta/*_snapshot.json",
  "openapi/v1.json",
  "site/src/components/site/contours/*.svg",
];
const MAX_COMMENT_CHARS = 60_000;
const INTERRUPT_EXIT_CODE = 130;
const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PRACTICE_REFERENCE_PATH =
  ".agents/skills/pr-review-suite/references/practices.md";

async function git(args, options = {}) {
  return run("git", args, options);
}

async function gh(args, options = {}) {
  return run("gh", args, options);
}

async function getRepoRoot() {
  const result = await git(["rev-parse", "--show-toplevel"]);
  return result.stdout.trim();
}

async function getRepoSlug() {
  const result = await gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
  return result.stdout.trim();
}

async function getDiffMetadata(baseRef, cwd, headRef = "HEAD") {
  // Display HEAD for reviewers in the pinned checkout; collect against the captured head.
  const diffRange = `${baseRef}...HEAD`;
  const namesResult = await git(["diff", "--name-only", `${baseRef}...${headRef}`], { cwd });
  const changedFiles = namesResult.stdout.trim().split("\n").filter(Boolean);
  if (changedFiles.length === 0) {
    throw new Error(`No changes found for git diff ${diffRange}`);
  }
  const commits = (
    await git(["log", `${baseRef}..${headRef}`, "--oneline"], { cwd })
  ).stdout.trim();
  const omittedFiles = changedFiles.filter((path) =>
    GENERATED_PAYLOAD_GLOBS.some((glob) => matchesScope(path, glob)),
  );
  const excludes = GENERATED_PAYLOAD_GLOBS.map((glob) => `:(exclude,glob)${glob}`);
  const patch = (
    await git(
      ["diff", "--no-ext-diff", "--unified=5", `${baseRef}...${headRef}`, "--", ".", ...excludes],
      { cwd },
    )
  ).stdout;
  if (patch.length > MAX_DIFF_CHARS) {
    throw new Error(
      `Diff is ${patch.length} characters without ${omittedFiles.length} generated file(s); limit is ${MAX_DIFF_CHARS}. Split the PR or run a targeted manual review.`,
    );
  }
  return { diffRange, changedFiles, omittedFiles, commits, patch };
}

function safeRead(path) {
  // Returns undefined for anything unreadable, including directories (EISDIR) and
  // dangling symlinks, so a caller never has to guard the read itself.
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

async function readFromBase(baseRef, path, cwd) {
  const result = await git(["show", `${baseRef}:${path}`], {
    cwd,
    allowFailure: true,
  });
  return result.code === 0 ? result.stdout : undefined;
}

async function selectContext(baseRef, changedFiles, cwd) {
  const rawFiles = await readFromBase(baseRef, ".greptile/files.json", cwd);
  const selected = new Set([
    "AGENTS.md",
    ".claude/CLAUDE.md",
    "GLOSSARY.md",
    ".greptile/rules.md",
    ".greptile/config.json",
  ]);
  if (!rawFiles) return [...selected];

  const config = JSON.parse(rawFiles);
  for (const entry of config.files || []) {
    if (
      !entry.scope ||
      entry.scope.some((scope) =>
        changedFiles.some((path) => matchesScope(path, scope)),
      )
    ) {
      selected.add(entry.path);
    }
  }
  return [...selected];
}

// Reviewers must judge against base-branch policy, but the review checkout is at the
// PR head and the Opus session has no shell to run "git show". Extracting the base
// copies to disk gives both reviewers the governing text through a plain file read.
async function materializeBaseContext(baseRef, contextFiles, artifactDir, cwd) {
  const root = join(artifactDir, "base-context");
  const materialized = [];
  for (const path of contextFiles) {
    const content = await readFromBase(baseRef, path, cwd);
    if (content === undefined) continue;
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
    materialized.push({ path, absolute });
  }
  return materialized;
}

function subscriptionOnlyEnv() {
  const env = {};
  for (const key of [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "TERM",
    "CODEX_HOME",
    "CLAUDE_CONFIG_DIR",
  ]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

async function runCodex(prompt, cwd, schemaPath, outputPath, timeoutMs, profile) {
  const settings = modelSettings("codex", profile);
  const args = [
    "exec",
    "-C",
    cwd,
    "--ephemeral",
    "-m",
    settings.model,
    "-c",
    `model_reasoning_effort="${settings.effort}"`,
    "-s",
    "read-only",
    "--output-schema",
    schemaPath,
    "-o",
    outputPath,
    "-",
  ];
  const result = await run("codex", args, {
    cwd,
    input: prompt,
    timeoutMs,
    env: subscriptionOnlyEnv(),
  });
  const raw = safeRead(outputPath) || result.stdout;
  return parseReviewOutput(raw, "Codex");
}

async function runOpus(prompt, cwd, schema, rawOutputPath, timeoutMs, readDir, profile) {
  const settings = modelSettings("opus", profile);
  const args = [
    "-p",
    "--model",
    settings.model,
    "--effort",
    settings.effort,
    "--permission-mode",
    "plan",
    "--safe-mode",
    "--no-chrome",
    "--tools",
    "Read,Grep,Glob",
    // The base-branch policy copies live in the artifact dir, outside the review
    // checkout, and Read is confined to cwd without this.
    "--add-dir",
    readDir,
    "--no-session-persistence",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(schema),
  ];
  const result = await run("claude", args, {
    cwd,
    input: prompt,
    timeoutMs,
    env: subscriptionOnlyEnv(),
  });
  writeFileSync(rawOutputPath, result.stdout);
  return parseReviewOutput(result.stdout, "Opus");
}

function validateReviewOutput(output, cwd) {
  if (!DEFAULT_PRACTICES.includes(output.practice)) {
    throw new Error(`Unknown practice in model output: ${output.practice}`);
  }
  if (!Array.isArray(output.findings) || output.findings.length > MAX_FINDINGS) {
    throw new Error(`Model returned more than ${MAX_FINDINGS} findings`);
  }
  const findings = [];
  const dropped = [];
  for (const finding of output.findings) {
    // Traversal and inverted ranges stay fatal: they indicate a model that is not
    // playing by the rules, not a merely unresolvable citation.
    if (
      finding.path.startsWith("/") ||
      finding.path.split("/").includes("..") ||
      finding.start_line > finding.end_line
    ) {
      throw new Error(`Unsafe finding location: ${finding.path}`);
    }
    // An unresolvable location drops one finding rather than the whole report. A
    // finding may legitimately cite a file the PR deleted, or name a directory.
    const content = safeRead(resolve(cwd, finding.path));
    if (content === undefined) {
      dropped.push(`${finding.path} (not a readable file in the reviewed head)`);
      continue;
    }
    const lineCount = content.split("\n").length;
    if (finding.end_line > lineCount) {
      dropped.push(
        `${finding.path}:${finding.end_line} (file has ${lineCount} lines)`,
      );
      continue;
    }
    findings.push(finding);
  }
  if (dropped.length > 0) {
    process.stderr.write(
      `Warning: dropped ${dropped.length} finding(s) with unresolvable locations: ${dropped.join("; ")}\n`,
    );
  }
  // Normalize the fields the aggregator dereferences. A model can satisfy the
  // parser and still omit these, and the aggregator runs outside the per-task catch.
  return {
    ...output,
    findings,
    summary:
      typeof output.summary === "string" && output.summary.trim()
        ? output.summary
        : "(the model returned no summary)",
    residual_risks: Array.isArray(output.residual_risks)
      ? output.residual_risks
      : [],
    droppedFindings: dropped,
  };
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function consume() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => consume(),
  );
  await Promise.all(workers);
  return results;
}

async function getPublisherLogin() {
  const result = await gh(["api", "user", "--jq", ".login"], {
    allowFailure: true,
  });
  if (result.code !== 0 || !result.stdout.trim()) {
    process.stderr.write(
      "Warning: could not resolve the authenticated GitHub login; matching the suite comment by marker position only.\n",
    );
    return undefined;
  }
  return result.stdout.trim();
}

async function publishComment(repo, prNumber, reportPath) {
  const listing = await gh([
    "api",
    "--paginate",
    "--slurp",
    `repos/${repo}/issues/${prNumber}/comments`,
  ]);
  const pages = JSON.parse(listing.stdout);
  const comments = pages.flat();
  const publisher = await getPublisherLogin();
  // The marker must open the body and the comment must be ours. A substring match
  // would adopt any human comment that quoted an earlier suite report.
  const existing = comments.find(
    (comment) =>
      comment.body?.trimStart().startsWith(COMMENT_MARKER) &&
      (!publisher || comment.user?.login === publisher),
  );
  const artifactDir = resolve(reportPath, "..");
  const inputPath = join(artifactDir, "comment-input.json");
  const body = truncateForComment(
    readFileSync(reportPath, "utf8"),
    MAX_COMMENT_CHARS,
    artifactDir,
  );
  writeFileSync(inputPath, JSON.stringify({ body }));

  if (existing) {
    const result = await gh([
      "api",
      "--method",
      "PATCH",
      `repos/${repo}/issues/comments/${existing.id}`,
      "--input",
      inputPath,
    ]);
    return JSON.parse(result.stdout).html_url;
  }
  const result = await gh([
    "api",
    "--method",
    "POST",
    `repos/${repo}/issues/${prNumber}/comments`,
    "--input",
    inputPath,
  ]);
  return JSON.parse(result.stdout).html_url;
}

// Tracks the temporary review checkout so an interrupt can still remove it. Without
// this, Ctrl-C during a long reviewer run leaves a worktree registered in the real repo.
let activeWorktree;
let signalCleanupInstalled = false;

function installSignalCleanup(cwd) {
  if (signalCleanupInstalled) return;
  signalCleanupInstalled = true;
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      if (activeWorktree) {
        const worktree = activeWorktree;
        activeWorktree = undefined;
        // Synchronous on purpose: the process is about to exit.
        spawnSync("git", ["worktree", "remove", "--force", worktree], { cwd });
      }
      process.exit(INTERRUPT_EXIT_CODE);
    });
  }
}

async function createReviewWorktree(cwd, artifactDir, headSha) {
  const worktree = join(artifactDir, "review-checkout");
  await git(["worktree", "add", "--detach", worktree, headSha], { cwd });
  return worktree;
}

async function removeReviewWorktree(cwd, worktree) {
  const result = await git(
    ["worktree", "remove", "--force", worktree],
    { cwd, allowFailure: true },
  );
  if (result.code !== 0) {
    process.stderr.write(
      `Warning: temporary review worktree was not removed: ${worktree}\n`,
    );
  }
}

async function selfTest() {
  selfTestDesignContext();
  await selfTestLocalReview();
  const sample = {
    practice: "standards",
    findings: [
      {
        severity: "P2",
        kind: "judgement_call",
        title: "Duplicated policy branch",
        path: "src/example.ts",
        start_line: 10,
        end_line: 12,
        basis: "Possible Duplicated Code",
        evidence: "The same branch appears in two changed functions",
        problem: "Future changes can update only one copy",
        smallest_safe_fix: "Extract the shared predicate",
      },
    ],
    summary: "One judgement-call smell.",
    residual_risks: [],
  };
  const parsed = parseReviewOutput(JSON.stringify(sample), "self-test");
  if (parsed.findings.length !== 1) throw new Error("parser self-test failed");
  if (!matchesScope("src/data-access/items.ts", "src/data-access/**")) {
    throw new Error("scope self-test failed");
  }
  // "**/" must span zero directories too, which is the form .greptile/files.json uses.
  for (const path of ["src/trace.ts", "src/a/b/trace.ts"]) {
    if (!matchesScope(path, "src/**/*trace*")) {
      throw new Error(`double-star scope self-test failed for ${path}`);
    }
  }
  if (matchesScope("other/trace.ts", "src/**/*trace*")) {
    throw new Error("double-star scope self-test matched too broadly");
  }
  const report = aggregateReport({
    pr: {
      number: 1,
      url: "https://github.com/example/repo/pull/1",
      baseRefName: "staging",
    },
    baseSha: "a".repeat(40),
    headSha: "b".repeat(40),
    reports: [{ practice: "standards", model: "codex", output: sample }],
    skippedPractices: new Map([["spec", "No spec available"]]),
  });
  if (!report.includes(COMMENT_MARKER) || !report.includes("Duplicated policy branch")) {
    throw new Error("aggregation self-test failed");
  }

  // Prompt checks. These are the offline guard against headings in practices.md
  // drifting: extractPracticeDefinition throws on a rename and nothing else catches it.
  const reference = readFileSync(
    join(SKILL_ROOT, "references/practices.md"),
    "utf8",
  );
  selfTestDesignRuntime(reference);
  const generated = (path) => GENERATED_PAYLOAD_GLOBS.some((glob) => matchesScope(path, glob));
  if (
    !generated("drizzle/meta/0121_snapshot.json") ||
    !generated("site/src/components/site/contours/sample.svg") ||
    generated("drizzle/0121_add_bins.sql") ||
    generated("drizzle/meta/_journal.json") ||
    generated("pnpm-lock.yaml")
  ) {
    throw new Error("generated-payload self-test failed");
  }
  // A 600k-char diff whose bulk is a snapshot must still fit, through the real
  // git path rather than a stub.
  const repo = mkdtempSync(join(tmpdir(), "review-suite-selftest-"));
  const inRepo = (args) => git(args, {
    cwd: repo,
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_COUNT: "0", GIT_TEMPLATE_DIR: "" },
  });
  // Hermetic: no signing or hooks from the user's global git config.
  const commit = ["-c", "user.email=t@t", "-c", "user.name=t", "-c", "commit.gpgsign=false", "commit", "-q", "--no-verify"];
  let bigDiff;
  try {
    await inRepo(["init", "-q"]);
    await inRepo([...commit, "--allow-empty", "-m", "base"]);
    mkdirSync(join(repo, "drizzle/meta"), { recursive: true });
    writeFileSync(join(repo, "drizzle/meta/0999_snapshot.json"), `${"x".repeat(600_000)}\n`);
    writeFileSync(join(repo, "drizzle/0999_example.sql"), "ALTER TABLE t ADD COLUMN c int;\n");
    await inRepo(["add", "."]);
    await inRepo([...commit, "-m", "snapshot"]);
    bigDiff = await getDiffMetadata("HEAD~1", repo);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
  if (
    bigDiff.omittedFiles.join() !== "drizzle/meta/0999_snapshot.json" ||
    !bigDiff.patch.includes("0999_example.sql") ||
    bigDiff.patch.length > MAX_DIFF_CHARS
  ) {
    throw new Error("generated-payload diff self-test failed");
  }
  const omittedReport = aggregateReport({
    pr: { number: 1, url: "https://github.com/example/repo/pull/1", baseRefName: "staging" },
    baseSha: "a".repeat(40),
    headSha: "b".repeat(40),
    reports: [],
    skippedPractices: new Map(),
    omittedFiles: ["drizzle/meta/0121_snapshot.json"],
  });
  if (!omittedReport.includes("drizzle/meta/0121_snapshot.json")) {
    throw new Error("omitted-files report self-test failed");
  }
  if (truncateForComment("x".repeat(200), 100, "/artifacts").length > 100) {
    throw new Error("comment truncation self-test failed");
  }
  process.stdout.write("Self-test passed.\n");
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${usage()}\n`);
    process.exitCode = 2;
    return;
  }

  if (options.mode === "help") {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (options.mode === "self-test") {
    await selfTest();
    return;
  }

  const cwd = await getRepoRoot();
  const artifactDir = options.artifactDir
    ? resolve(cwd, options.artifactDir)
    : mkdtempSync(join(tmpdir(), "noma-pr-review-suite-"));
  if (options.prior.some((path) => resolve(path) === join(artifactDir, REPORT_FILENAME))) {
    throw new Error("A --prior path would be overwritten by this run; use a new --artifact-dir per round.");
  }
  mkdirSync(artifactDir, { recursive: true });
  const timeoutMs = options.timeoutMinutes * 60 * 1000;
  const { priors, round } = loadPriors(options.prior);
  const localTarget = options.local ? await resolveTarget(options, cwd) : undefined;

  const versions = {
    git: await requireCommand("git"),
    gh: await requireCommand("gh"),
  };
  if (options.mode !== "plan") {
    if (options.models.includes("codex")) {
      versions.codex = await requireCommand("codex");
    }
    if (options.models.includes("opus")) {
      versions.claude = await requireCommand("claude");
    }
  }

  const { pr, base, headSha, baseFetchFailed } = localTarget || await resolveTarget(options, cwd);
  const diff = await getDiffMetadata(base.name, cwd, headSha);
  const spec = await discoverSpec(options, pr, diff, cwd, artifactDir);
  // The review criteria must come from the base branch. Reading the working tree
  // would let the PR under review rewrite the standards it is judged against.
  let practiceReferenceSource = "base";
  const basePracticeReference = await readFromBase(
    base.name,
    PRACTICE_REFERENCE_PATH,
    cwd,
  );
  let practiceReference = basePracticeReference;
  if (practiceReference === undefined) {
    // The PR that introduces this skill has no copy in its base commit. Fall back
    // rather than making the suite unable to review its own introducing PR.
    practiceReferenceSource = "head";
    practiceReference = readFileSync(
      join(SKILL_ROOT, "references/practices.md"),
      "utf8",
    );
    process.stderr.write(
      `Warning: ${PRACTICE_REFERENCE_PATH} is absent from base ${base.sha}; using the PR head copy as review criteria.\n`,
    );
  }

  const { practices, skippedPractices } = selectPractices({
    practices: options.practices,
    spec,
    changedFiles: diff.changedFiles,
    basePracticeReference,
  });
  const selectedContext = await selectContext(base.name, diff.changedFiles, cwd);
  const contextFiles = await materializeBaseContext(
    base.name, selectedContext, artifactDir, cwd,
  );
  const designContextFiles = [];
  if (practices.includes("design")) {
    const basePaths = await git(
      ["ls-tree", "-r", "--name-only", "-z", base.name, "--", ".agents/skills"],
      { cwd },
    );
    designContextFiles.push(...await materializeBaseContext(
      base.name, selectDesignContextPaths(basePaths.stdout.split("\0"), practices), artifactDir, cwd,
    ));
  }
  const globalDesign = practices.includes("design")
    ? materializeGlobalDesignSkill(artifactDir)
    : {};
  if (globalDesign.contextFile) designContextFiles.push(globalDesign.contextFile);

  const metadata = {
    generatedAt: new Date().toISOString(),
    mode: options.mode,
    versions,
    pr,
    base,
    headSha,
    diff: {
      diffRange: diff.diffRange,
      changedFiles: diff.changedFiles,
      commits: diff.commits,
      omittedFiles: diff.omittedFiles,
      patchChars: diff.patch.length,
    },
    spec,
    contextFiles,
    designContextFiles,
    designGlobalSkill: globalDesign.designGlobalSkill,
    practiceReferenceSource,
    profile: options.profile,
    models: profileModels(options.profile),
    selectedModels: options.models,
    round,
    priors: options.prior,
    ...(options.local ? { baseFetchFailed } : {}),
    practices,
    skippedPractices: [...skippedPractices],
  };
  writeFileSync(
    join(artifactDir, "metadata.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
  const schemaPath = join(artifactDir, "review-schema.json");
  writeFileSync(schemaPath, `${JSON.stringify(REVIEW_SCHEMA, null, 2)}\n`);

  const tasks = [];
  for (const practice of practices) {
    for (const model of options.models) {
      const prompt = createPrompt({
        practice,
        model,
        profile: options.profile,
        priors,
        pr,
        baseRef: base.name,
        baseSha: base.sha,
        headSha,
        diff,
        contextFiles: practice === "design" ? [...contextFiles, ...designContextFiles] : contextFiles,
        spec,
        practiceDefinition: extractPracticeDefinition(
          practiceReference,
          practice,
        ),
      });
      const stem = `${practice}-${model}`;
      const promptPath = join(artifactDir, `${stem}-prompt.md`);
      writeFileSync(promptPath, prompt);
      tasks.push({ practice, model, prompt, stem });
    }
  }

  if (options.mode === "plan") {
    process.stdout.write(
      `Plan written to ${artifactDir}\n${tasks.length} review task(s); no models run and no GitHub changes made.\n`,
    );
    return;
  }

  const reviewCwd = await createReviewWorktree(cwd, artifactDir, headSha);
  activeWorktree = reviewCwd;
  installSignalCleanup(cwd);
  let reports;
  try {
    reports = await mapWithConcurrency(
      tasks,
      options.concurrency,
      async (task) => {
        try {
          const output =
            task.model === "codex"
              ? await runCodex(
                  task.prompt,
                  reviewCwd,
                  schemaPath,
                  join(artifactDir, `${task.stem}.json`),
                  timeoutMs,
                  options.profile,
                )
              : await runOpus(
                  task.prompt,
                  reviewCwd,
                  REVIEW_SCHEMA,
                  join(artifactDir, `${task.stem}-raw.json`),
                  timeoutMs,
                  artifactDir,
                  options.profile,
                );
          const validated = validateReviewOutput(output, reviewCwd);
          if (validated.practice !== task.practice) {
            throw new Error(
              `${displayModel(task.model, options.profile)} returned practice ${validated.practice}; expected ${task.practice}`,
            );
          }
          writeFileSync(
            join(artifactDir, `${task.stem}-normalized.json`),
            `${JSON.stringify(validated, null, 2)}\n`,
          );
          return { ...task, prompt: undefined, output: validated };
        } catch (error) {
          return { ...task, prompt: undefined, error: error.message };
        }
      },
    );
  } finally {
    activeWorktree = undefined;
    await removeReviewWorktree(cwd, reviewCwd);
  }

  const reportPath = join(artifactDir, "review-comment.md");
  const aggregate = {
    pr,
    baseSha: base.sha,
    headSha,
    reports,
    skippedPractices,
    omittedFiles: diff.omittedFiles,
    round,
    priors,
    profile: options.profile,
  };
  writeFileSync(reportPath, aggregateReport(aggregate));
  writeFileSync(
    join(artifactDir, REPORT_FILENAME),
    `${JSON.stringify(buildReportJson(aggregate), null, 2)}\n`,
  );
  if (options.local) {
    const warning = await verifyLocalHead(headSha, cwd);
    if (warning) process.stderr.write(warning);
  }
  const failures = reports.filter((report) => report.error);
  if (failures.length > 0) {
    const detail = failures
      .map(
        (failure) =>
          `${displayPractice(failure.practice)} / ${displayModel(failure.model, options.profile)}: ${
            failure.error
          }`,
      )
      .join("\n");
    throw new Error(
      `Review suite incomplete; refusing to publish.\n${detail}\nArtifacts: ${artifactDir}`,
    );
  }

  if (options.mode === "dry-run") {
    process.stdout.write(
      `Dry run complete. Report: ${reportPath}\nNo GitHub changes made.\n`,
    );
    return;
  }

  await verifyRemoteHead(options.pr, headSha);
  const repo = await getRepoSlug();
  const commentUrl = await publishComment(repo, pr.number, reportPath);
  process.stdout.write(
    `Published PR review suite.\nPR: ${pr.url}\nHead: ${headSha}\nComment: ${commentUrl}\nArtifacts: ${artifactDir}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
