---
name: implement-ticket
description: The one flow from a GitHub issue or plan to a merged PR in noma-dmrv. Use when implementing an issue or plan, running several issues in parallel, or deciding how many review rounds a change gets before and after its PR opens.
argument-hint: "<issue number | issue URL | plan file path>"
---

Carry one ticket from brief to merge. Agents work alone until the PR is ready: every full review round runs locally against the branch, and the PR opens **ready** for one light pass. The main session is the **conductor**: it scopes, routes work by `~/.claude/model-selection.md`, verifies every finding against the code, reviews every diff, commits and lands. It keeps subagents' compact returns, not their diffs. For several independent issues, run this flow once per issue side by side; serialize issues that share files or migrations.

Concrete IDs, commands and prompt skeletons are in [`references/playbook.md`](references/playbook.md). Pull the section you need when you reach its step.

## 1. Brief and worktree

Resolve the target (`gh issue view <n> --json title,body,labels,url`, or read the plan file). Write a brief to the scratchpad: goal, acceptance criteria, in-scope paths, out-of-scope, how to see it working. Link the issue by URL; leave its body where it is. Cut the worktree with `scripts/worktree.sh new <name> <type>/<kebab-desc>` and move the board item to **In progress** (playbook: Board).

Done when: the brief file exists, the worktree is on its own branch off `origin/staging`, and the board item is In progress (an issue target only).

## 2. Implement

Route by the model policy: non-UI changes go to Codex through the **codex-implementation** skill; UI, copy and API design stay with Claude and load **noma-design**. Give the implementer the brief path and the worktree path (playbook: Implementer). It commits on the feature branch with conventional commits.

Done when: every acceptance criterion in the brief maps to a committed change, and the conductor has read the diff.

## 3. Gates

Run in the worktree: `pnpm verify:static`, the tests that cover the change, and for a UI change Before | After screenshots at the same viewport and state (playbook: Evidence). Read the real output; a piped exit code hides failures.

Done when: every gate is green on the committed head and the shots exist locally.

## 4. Local review rounds

Run the suite against the branch, one suite at a time across sessions:

```bash
node .agents/skills/pr-review-suite/scripts/run-pr-review-suite.mjs --local --issue <n> --dry-run --artifact-dir <scratch>/round-<k>
```

A plan target uses `--spec <plan path>` instead of `--issue`. Round 1 runs with no `--prior`. Each later round passes every earlier `report.json` as `--prior`, in round order, after the conductor has set each finding's `disposition` (`fixed`, or `declined` with a `reason`).

For each round:

1. The conductor verifies every P0-P2 finding against the code. A finding is **valid** when the code at the reviewed head shows the defect. Check fixes that add compatibility for old rows against the issue and the pre-production policy in `.claude/CLAUDE.md` first.
2. An implementer fixes the valid ones and commits once the gates are green (playbook: Fixer); the conductor reviews the fix diff.
3. Declined findings get a one-line reason in `report.json`. P3s are fixed only when trivial; otherwise decline them with a reason.
4. Rerun the gates from step 3.

**Stop rule.** Stop after the first round with no valid P0-P2. Cap at 3 rounds. Rounds 4 and 5 run only while a valid P0, or a valid P1 on security, auth/tenancy, money or data integrity, stays open; a fix no later round has reviewed still counts as open. Still open at the cap: stop, open no PR, and ask Kenji on an answer page with the open findings.

Done when: the stop rule ends the loop with no valid P0-P2 open, the gates are green on the last reviewed head, and every finding in every round carries a disposition.

## 5. Open the PR ready

Push from the main checkout, open the PR against `staging` with the **pr** skill's body (`Closes #<n>`), and add this section, which later retros count:

```markdown
## Reviewed before opening

| round | head | P0 | P1 | P2 | P3 | fixed | declined |
|---|---|---|---|---|---|---|---|
| 1 | `abc1234` | 0 | 2 | 5 | 6 | 6 | 7 |
| 2 | `def5678` | 0 | 0 | 1 | 3 | 0 | 4 |

Last reviewed head: `def5678…` (full SHA). Models: <the last round's `Models:` header line>.
Declined: <one line per declined P0-P2: id, title, reason>.
```

Commits after the last reviewed head, if any, are named below the table with why they skipped a round. Move the board item to **In review (Maji)**.

Done when: the PR is open and ready (not draft), the section's last reviewed head is an ancestor of the PR head, and the board moved.

## 6. Light pass in the PR

```bash
node .agents/skills/pr-review-suite/scripts/run-pr-review-suite.mjs --pr <n> --profile light --publish
```

Verify each finding against the code. Fix valid P0 and P1 only, through the Fixer (playbook: Fixer), committing once the step 3 gates are green. Decline valid P2s with a reason in a PR comment, or file them as follow-up issues; decline invalid findings with a one-line reason. A fix commit that touches auth, tenancy or data code (schema, migrations, data-access) gets a **codex-review** of that delta before landing, with that skill's escalation for auth and data diffs and never the model that wrote the fix; no second suite pass.

Done when: the light-pass comment is on the PR, every P0/P1 is fixed or declined with a reason, every P2 is declined or filed, and CI is green on the head.

## 7. Merge

Publish the merge card per the **pr** skill's Done state. Once Kenji's saved doc says `choice: merge` and its `sha` equals the PR head, land with `scripts/pr-land.sh <pr> --teardown <worktree-name>`. The script merges staging into a DIRTY branch by itself; Kenji's OK holds through that merge when the PR diff is unchanged.

Done when: the PR state is MERGED, the worktree is torn down, and the issue is closed.

## Report

One compact summary per ticket: issue, branch, PR URL, local rounds with their P0-P3 counts, light-pass outcome, what shipped, merge state.
