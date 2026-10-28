import process from "node:process";

import { run } from "./review-runtime.mjs";

const git = (args, options) => run("git", args, options);
const gh = (args, options) => run("gh", args, options);
const MAX_UNTRACKED_PATHS = 5;

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

export async function verifyRemoteHead(prTarget, expectedSha) {
  const current = await getPr(prTarget);
  if (current.headRefOid !== expectedSha) {
    throw new Error(
      `PR head changed during review (${expectedSha} -> ${current.headRefOid}); refusing to publish.`,
    );
  }
}

export async function checkLocalWorktree(cwd, { gitCommand = git } = {}) {
  const tracked = await gitCommand(["status", "--porcelain", "--untracked-files=no"], { cwd });
  if (tracked.stdout.trim()) {
    throw new Error("Local review requires a clean tracked worktree; commit your changes first.");
  }
  const untracked = await gitCommand(["ls-files", "--others", "--exclude-standard"], { cwd });
  if (untracked.stdout.trim()) {
    const paths = untracked.stdout.trim().split("\n").slice(0, MAX_UNTRACKED_PATHS);
    throw new Error(`Local review requires a clean worktree; commit or remove untracked files first: ${paths.join(", ")}`);
  }
}

export async function resolveLocalTarget(baseName, cwd, { gitCommand = git, warn = (message) => process.stderr.write(message) } = {}) {
  await checkLocalWorktree(cwd, { gitCommand });
  await gitCommand(["check-ref-format", `refs/remotes/origin/${baseName}`], { cwd });
  let baseFetchFailed = false;
  try {
    await gitCommand(["fetch", "--no-tags", "origin", `+refs/heads/${baseName}:refs/remotes/origin/${baseName}`], { cwd });
  } catch {
    baseFetchFailed = true;
    warn(`Warning: failed to fetch origin ${baseName}; continuing with existing origin/${baseName}.\n`);
  }
  const baseSha = (await gitCommand(["merge-base", `origin/${baseName}`, "HEAD"], { cwd })).stdout.trim();
  const headSha = (await gitCommand(["rev-parse", "HEAD"], { cwd })).stdout.trim();
  const branch = (await gitCommand(["branch", "--show-current"], { cwd })).stdout.trim() || "HEAD";
  const title = (await gitCommand(["log", "--reverse", "--format=%s", `origin/${baseName}..HEAD`], { cwd })).stdout.split("\n")[0];
  return {
    pr: { mode: "local", title, body: "", headRefName: branch, baseRefName: baseName, headRefOid: headSha },
    base: { name: baseSha, sha: baseSha },
    headSha,
    baseFetchFailed,
  };
}

export async function resolveTarget(options, cwd) {
  if (options.local) return resolveLocalTarget(options.base, cwd);
  const pr = await getPr(options.pr);
  const base = await resolveBaseRef(pr, cwd);
  const headSha = await verifyHead(pr, cwd);
  return { pr, base, headSha };
}

export async function verifyLocalHead(expectedSha, cwd, gitCommand = git) {
  const current = (await gitCommand(["rev-parse", "HEAD"], { cwd })).stdout.trim();
  if (current !== expectedSha) {
    return `Warning: Local HEAD changed during review (${expectedSha} -> ${current}); the report remains valid for reviewed head ${expectedSha}.\n`;
  }
}
