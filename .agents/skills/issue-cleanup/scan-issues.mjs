#!/usr/bin/env node
/**
 * scan-issues.mjs — read-only backlog inventory for the /issue-cleanup skill.
 *
 * Shells out to `gh` (no npm deps) and writes two files to the output dir:
 *   issues-snapshot.json  — full open-issue data (bodies, comments, closing-PR
 *                           refs, sub-issue relations) + recently closed issues
 *                           + recent merged-PR titles for "already shipped" checks
 *   issues-index.md       — one line per open issue, for cheap orchestration
 *
 * Usage: node .claude/skills/issue-cleanup/scan-issues.mjs <output-dir>
 *
 * Read-only by design: only GraphQL queries and `gh pr list` — never mutations.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PAGE_SIZE = 25; // issues per GraphQL page — keeps each response well under gh limits
const COMMENT_BODY_MAX = 4000; // chars kept per comment body
const CLOSED_LOOKBACK_DAYS = 60; // closed issues kept as dedup context
const MERGED_PR_LIMIT = 100;

const outDir = process.argv[2];
if (!outDir) {
  console.error("Usage: node scan-issues.mjs <output-dir>");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

function gh(args, input) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    input,
  });
}

function graphql(query, variables) {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [k, v] of Object.entries(variables)) {
    if (v === null || v === undefined) continue;
    args.push(typeof v === "number" ? "-F" : "-f", `${k}=${v}`);
  }
  return JSON.parse(gh(args));
}

const repoInfo = JSON.parse(gh(["repo", "view", "--json", "owner,name"]));
const owner = repoInfo.owner.login;
const name = repoInfo.name;

// ---------- open issues (paginated) ----------

const OPEN_ISSUES_QUERY = `
query($owner: String!, $name: String!, $pageSize: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    issues(states: OPEN, first: $pageSize, after: $cursor,
           orderBy: { field: CREATED_AT, direction: ASC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title body createdAt updatedAt
        labels(first: 15) { nodes { name } }
        comments(first: 50) {
          totalCount
          nodes { author { login } createdAt body }
        }
        reactions(first: 1) { totalCount }
        parent { number title }
        subIssues(first: 30) { totalCount nodes { number title state } }
        closedByPullRequestsReferences(first: 10, includeClosedPrs: true) {
          nodes { number title state mergedAt }
        }
        timelineItems(itemTypes: [CROSS_REFERENCED_EVENT], first: 30) {
          nodes {
            ... on CrossReferencedEvent {
              source {
                ... on PullRequest { number title state mergedAt }
                ... on Issue { number title state }
              }
            }
          }
        }
      }
    }
  }
}`;

const openIssues = [];
let cursor = null;
do {
  const data = graphql(OPEN_ISSUES_QUERY, {
    owner,
    name,
    pageSize: PAGE_SIZE,
    cursor,
  });
  const page = data.data.repository.issues;
  for (const n of page.nodes) {
    openIssues.push({
      number: n.number,
      title: n.title,
      body: n.body ?? "",
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      labels: n.labels.nodes.map((l) => l.name),
      reactionCount: n.reactions.totalCount,
      parent: n.parent ? { number: n.parent.number, title: n.parent.title } : null,
      subIssues: n.subIssues.nodes.map((s) => ({
        number: s.number,
        title: s.title,
        state: s.state,
      })),
      closingPRs: n.closedByPullRequestsReferences.nodes.map((p) => ({
        number: p.number,
        title: p.title,
        state: p.state,
        mergedAt: p.mergedAt,
      })),
      crossRefs: n.timelineItems.nodes
        .map((t) => t.source)
        .filter((s) => s && s.number)
        .map((s) => ({
          number: s.number,
          title: s.title,
          state: s.state,
          mergedAt: s.mergedAt ?? undefined,
          type: s.mergedAt !== undefined ? "pr" : "issue-or-pr",
        })),
      commentCount: n.comments.totalCount,
      comments: n.comments.nodes.map((c) => ({
        author: c.author?.login ?? "ghost",
        createdAt: c.createdAt,
        body: (c.body ?? "").slice(0, COMMENT_BODY_MAX),
      })),
    });
  }
  cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
} while (cursor);

// ---------- recently closed issues (dedup context) ----------

const CLOSED_ISSUES_QUERY = `
query($owner: String!, $name: String!, $pageSize: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    issues(states: CLOSED, first: $pageSize, after: $cursor,
           orderBy: { field: UPDATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title closedAt stateReason
        labels(first: 15) { nodes { name } }
      }
    }
  }
}`;

const closedCutoff = Date.now() - CLOSED_LOOKBACK_DAYS * 24 * 3600 * 1000;
const closedIssues = [];
cursor = null;
outer: do {
  const data = graphql(CLOSED_ISSUES_QUERY, {
    owner,
    name,
    pageSize: PAGE_SIZE,
    cursor,
  });
  const page = data.data.repository.issues;
  for (const n of page.nodes) {
    if (n.closedAt && Date.parse(n.closedAt) < closedCutoff) break outer;
    closedIssues.push({
      number: n.number,
      title: n.title,
      closedAt: n.closedAt,
      stateReason: n.stateReason,
      labels: n.labels.nodes.map((l) => l.name),
    });
  }
  cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
} while (cursor);

// ---------- recent merged PRs (already-shipped signal) ----------

const mergedPRs = JSON.parse(
  gh([
    "pr", "list", "--state", "merged", "--base", "staging",
    "--limit", String(MERGED_PR_LIMIT),
    "--json", "number,title,mergedAt",
  ]),
);

// ---------- write outputs ----------

const snapshot = {
  generatedAt: new Date().toISOString(),
  repo: `${owner}/${name}`,
  openIssueCount: openIssues.length,
  openIssues,
  recentlyClosedIssues: closedIssues,
  recentMergedPRs: mergedPRs,
};
const snapshotPath = join(outDir, "issues-snapshot.json");
writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));

const ageDays = (iso) =>
  Math.floor((Date.now() - Date.parse(iso)) / (24 * 3600 * 1000));

const indexLines = openIssues.map((i) => {
  const closing = i.closingPRs
    .map((p) => `PR#${p.number}${p.mergedAt ? "(merged)" : `(${p.state.toLowerCase()})`}`)
    .join(",");
  const rel = [
    i.parent ? `parent:#${i.parent.number}` : "",
    i.subIssues.length ? `subs:${i.subIssues.length}` : "",
    closing ? `closedBy:${closing}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `- #${i.number} · ${ageDays(i.createdAt)}d old · upd ${i.updatedAt.slice(0, 10)} · [${i.labels.join(",") || "no-labels"}] · ${i.commentCount}c${rel ? ` · ${rel}` : ""} · ${i.title}`;
});
const indexPath = join(outDir, "issues-index.md");
writeFileSync(
  indexPath,
  `# Open-issue index — ${owner}/${name} — ${snapshot.generatedAt}\n\n${indexLines.join("\n")}\n`,
);

console.log(`open issues:            ${openIssues.length}`);
console.log(`recently closed (${CLOSED_LOOKBACK_DAYS}d): ${closedIssues.length}`);
console.log(`merged PRs sampled:     ${mergedPRs.length}`);
console.log(`snapshot: ${snapshotPath}`);
console.log(`index:    ${indexPath}`);
