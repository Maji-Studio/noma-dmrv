import { readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { run } from "./review-runtime.mjs";

const git = (args, options) => run("git", args, options);
const gh = (args, options) => run("gh", args, options);

function safeRead(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

export async function discoverSpec(options, pr, diff, cwd, artifactDir, { gitCommand = git, ghCommand = gh } = {}) {
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

  if (options.issue) {
    const result = await ghCommand(["issue", "view", options.issue, "--json", "title,body,url"]);
    const fetched = JSON.parse(result.stdout);
    const path = join(artifactDir, "spec.md");
    writeFileSync(path, `# ${fetched.title}\n\nSource: ${fetched.url}\n\n${fetched.body || ""}\n`);
    return { source: fetched.url, path };
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

  const referenceText = pr.mode === "local"
    ? diff.commits
    : `${pr.title}\n${pr.body || ""}\n${diff.commits}`;
  // The keyword is mandatory. When it was optional this matched any bare "#123",
  // so "Supersedes PR #583" or a squash subject ending "(#585)" was fetched as the
  // authoritative spec.
  const issueMatch = referenceText.match(
    /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?|issue)\s*#(\d+)/i,
  );
  if (issueMatch) {
    const result = await ghCommand(
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
  const tracked = await gitCommand(
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

