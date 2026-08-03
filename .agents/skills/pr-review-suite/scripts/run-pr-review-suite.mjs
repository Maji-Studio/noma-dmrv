#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  createPrompt,
  extractPracticeDefinition,
  MAX_FINDINGS,
  parseReviewOutput,
  REVIEW_SCHEMA,
} from "./review-prompt.mjs";
import {
  aggregateReport,
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
  truncateForComment,
  usage,
} from "./review-runtime.mjs";

const MAX_DIFF_CHARS = 500_000;
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

async function getPr(prTarget) {
  const fields = [
    "number",
    "url",
    "title",
    "body",
    "baseRefName",
    "baseRefOid",
    "headRefName",
    "headRefOid",
    "isDraft",
    "files",
    "closingIssuesReferences",
  ].join(",");
  const args = ["pr", "view"];
  if (prTarget) args.push(prTarget);
  args.push("--json", fields);
  const result = await gh(args);
  return JSON.parse(result.stdout);
}

async function getRepoSlug() {
  const result = await gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
  return result.stdout.trim();
}

async function resolveBaseRef(pr, cwd) {
  const existing = await git(["cat-file", "-e", `${pr.baseRefOid}^{commit}`], {
    cwd,
    allowFailure: true,
  });
  if (existing.code !== 0) {
    await git(["fetch", "--no-tags", "origin", pr.baseRefName], { cwd });
  }
  const resolved = await git(["rev-parse", "--verify", pr.baseRefOid], { cwd });
  return { name: pr.baseRefOid, sha: resolved.stdout.trim() };
}

async function verifyHead(pr, cwd) {
  const local = (await git(["rev-parse", "HEAD"], { cwd })).stdout.trim();
  if (local !== pr.headRefOid) {
    throw new Error(
      `Local HEAD ${local} does not match PR head ${pr.headRefOid}. Check out and pull ${pr.headRefName}.`,
    );
  }
  return local;
}

async function getDiffMetadata(baseRef, cwd) {
  const diffRange = `${baseRef}...HEAD`;
  const namesResult = await git(["diff", "--name-only", diffRange], { cwd });
  const changedFiles = namesResult.stdout.trim().split("\n").filter(Boolean);
  if (changedFiles.length === 0) {
    throw new Error(`No changes found for git diff ${diffRange}`);
  }
  const commits = (
    await git(["log", `${baseRef}..HEAD`, "--oneline"], { cwd })
  ).stdout.trim();
  const patch = (
    await git(
      ["diff", "--no-ext-diff", "--unified=5", diffRange],
      { cwd },
    )
  ).stdout;
  if (patch.length > MAX_DIFF_CHARS) {
    throw new Error(
      `Diff is ${patch.length} characters; limit is ${MAX_DIFF_CHARS}. Split the PR or run a targeted manual review.`,
    );
  }
  return { diffRange, changedFiles, commits, patch };
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

async function discoverSpec(options, pr, diff, cwd, artifactDir) {
  if (options.spec) {
    const absolute = resolve(cwd, options.spec);
    const content = safeRead(absolute);
    if (content === undefined) {
      throw new Error(`Spec file not found: ${absolute}`);
    }
    const path = join(artifactDir, "spec.md");
    writeFileSync(path, `# Spec source: ${relative(cwd, absolute)}\n\n${content}`);
    return { source: relative(cwd, absolute), path };
  }

  const issue = pr.closingIssuesReferences?.[0];
  if (issue?.body) {
    const path = join(artifactDir, "spec.md");
    writeFileSync(
      path,
      `# ${issue.title}\n\nSource: ${issue.url}\n\n${issue.body}\n`,
    );
    return { source: issue.url, path };
  }

  const referenceText = `${pr.title}\n${pr.body || ""}\n${diff.commits}`;
  // The keyword is mandatory. When it was optional this matched any bare "#123",
  // so "Supersedes PR #583" or a squash subject ending "(#585)" was fetched as the
  // authoritative spec.
  const issueMatch = referenceText.match(
    /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?|issue)\s*#(\d+)/i,
  );
  if (issueMatch) {
    const result = await gh(
      ["issue", "view", issueMatch[1], "--json", "title,body,url"],
      { allowFailure: true },
    );
    if (result.code === 0) {
      const fetched = JSON.parse(result.stdout);
      const path = join(artifactDir, "spec.md");
      writeFileSync(
        path,
        `# ${fetched.title}\n\nSource: ${fetched.url}\n\n${fetched.body || ""}\n`,
      );
      return { source: fetched.url, path };
    }
  }

  const branchTerms = pr.headRefName
    .split(/[-_/]+/)
    .filter((term) => term.length >= 4);
  const tracked = await git(
    ["ls-files", "docs", "specs", ".scratch"],
    { cwd, allowFailure: true },
  );
  const candidates = tracked.stdout
    .trim()
    .split("\n")
    .filter((path) => path.endsWith(".md"))
    .map((path) => ({
      path,
      score: branchTerms.filter((term) => path.toLowerCase().includes(term.toLowerCase()))
        .length,
    }))
    .filter((candidate) => candidate.score >= 2)
    .sort((left, right) => right.score - left.score);

  if (candidates[0]) {
    const content = safeRead(resolve(cwd, candidates[0].path));
    if (content !== undefined) {
      const path = join(artifactDir, "spec.md");
      writeFileSync(path, `# Spec source: ${candidates[0].path}\n\n${content}`);
      return { source: candidates[0].path, path };
    }
  }

  return undefined;
}

async function selectContext(baseRef, changedFiles, cwd) {
  const rawFiles = await readFromBase(baseRef, ".greptile/files.json", cwd);
  const selected = new Set([
    "AGENTS.md",
    ".claude/CLAUDE.md",
    "CONTEXT.md",
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

async function runCodex(prompt, cwd, schemaPath, outputPath, timeoutMs) {
  const args = [
    "exec",
    "-C",
    cwd,
    "--ephemeral",
    "-m",
    "gpt-5.6-sol",
    "-c",
    'model_reasoning_effort="high"',
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

async function runOpus(prompt, cwd, schema, rawOutputPath, timeoutMs, readDir) {
  const args = [
    "-p",
    "--model",
    "opus",
    "--effort",
    "high",
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

async function verifyRemoteHead(prTarget, expectedSha) {
  const current = await getPr(prTarget);
  if (current.headRefOid !== expectedSha) {
    throw new Error(
      `PR head changed during review (${expectedSha} -> ${current.headRefOid}); refusing to publish.`,
    );
  }
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

function selfTest() {
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
    skippedPractices: new Set(["spec"]),
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
  const contextFiles = [
    { path: "CONTEXT.md", absolute: "/artifacts/base-context/CONTEXT.md" },
  ];
  for (const practice of DEFAULT_PRACTICES) {
    const practiceDefinition = extractPracticeDefinition(reference, practice);
    if (!practiceDefinition.startsWith(`## ${displayPractice(practice)}`)) {
      throw new Error(`practice definition self-test failed for ${practice}`);
    }
    const prompt = createPrompt({
      practice,
      model: "codex",
      pr: { number: 1, title: "Example", body: "Body" },
      baseRef: "a".repeat(40),
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      diff: {
        diffRange: "base...HEAD",
        changedFiles: ["src/example.ts"],
        commits: "abc1234 example",
        patch: "diff --git a/src/example.ts b/src/example.ts",
      },
      contextFiles,
      spec: undefined,
      practiceDefinition,
    });
    if (
      !prompt.includes(practiceDefinition) ||
      !prompt.includes(contextFiles[0].absolute)
    ) {
      throw new Error(`prompt self-test failed for ${practice}`);
    }
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
    selfTest();
    return;
  }

  const cwd = await getRepoRoot();
  const artifactDir = options.artifactDir
    ? resolve(cwd, options.artifactDir)
    : mkdtempSync(join(tmpdir(), "noma-pr-review-suite-"));
  mkdirSync(artifactDir, { recursive: true });
  const timeoutMs = options.timeoutMinutes * 60 * 1000;

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

  const pr = await getPr(options.pr);
  const base = await resolveBaseRef(pr, cwd);
  const headSha = await verifyHead(pr, cwd);
  const diff = await getDiffMetadata(base.name, cwd);
  const spec = await discoverSpec(options, pr, diff, cwd, artifactDir);
  const selectedContext = await selectContext(base.name, diff.changedFiles, cwd);
  const contextFiles = await materializeBaseContext(
    base.name,
    selectedContext,
    artifactDir,
    cwd,
  );

  // The review criteria must come from the base branch. Reading the working tree
  // would let the PR under review rewrite the standards it is judged against.
  let practiceReferenceSource = "base";
  let practiceReference = await readFromBase(
    base.name,
    PRACTICE_REFERENCE_PATH,
    cwd,
  );
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

  const skippedPractices = new Set();
  const practices = options.practices.filter((practice) => {
    if (practice === "spec" && !spec) {
      skippedPractices.add(practice);
      return false;
    }
    return true;
  });

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
      patchChars: diff.patch.length,
    },
    spec,
    contextFiles,
    practiceReferenceSource,
    models: options.models,
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
        pr,
        baseRef: base.name,
        baseSha: base.sha,
        headSha,
        diff,
        contextFiles,
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
                )
              : await runOpus(
                  task.prompt,
                  reviewCwd,
                  REVIEW_SCHEMA,
                  join(artifactDir, `${task.stem}-raw.json`),
                  timeoutMs,
                  artifactDir,
                );
          const validated = validateReviewOutput(output, reviewCwd);
          if (validated.practice !== task.practice) {
            throw new Error(
              `${displayModel(task.model)} returned practice ${validated.practice}; expected ${task.practice}`,
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
  writeFileSync(
    reportPath,
    aggregateReport({
      pr,
      baseSha: base.sha,
      headSha,
      reports,
      skippedPractices,
    }),
  );
  const failures = reports.filter((report) => report.error);
  if (failures.length > 0) {
    const detail = failures
      .map(
        (failure) =>
          `${displayPractice(failure.practice)} / ${displayModel(failure.model)}: ${
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
