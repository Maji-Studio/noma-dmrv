---
name: resolve-open-prs
description: Sweep every open PR to merged — survey and queue them, resolve review comments, fix confirmed findings from a multi-model review panel, and merge each one in turn.
argument-hint: "[PR numbers to include — blank = all open PRs]"
disable-model-invocation: true
---

Work the repo's **merge queue** to empty. The main thread is a **conductor**: it surveys, orders, and gates — per-PR legwork (diff comparison, comment fixes, reviews) goes to subagents and the `pr-review-panel` workflow, and only their compact returns enter the main window. Codex mechanics live in the **codex-implementation** and **codex-review** skills (`.claude/skills/codex-*/SKILL.md`) — point subagents there instead of restating commands.

**Guardrails.** `pnpm` only. Never commit to `staging`/`main`. **Never auto-merge a `staging` → `main` promotion PR** — flag it in the report as its own explicit step for the user. Draft PRs are flagged, not processed, unless the user named them. Every review finding is verified against the actual code before acting — false positives (including bogus P0s) are common. Never trust exit 0 from a piped command. Codex and CodeRabbit are best-effort — degrade gracefully if absent.

## Phase 1 — Survey & queue

Gather the full picture, then bucket every open PR exactly once:

```bash
gh pr list --state open --json number,title,headRefName,baseRefName,isDraft,mergeable,reviewDecision,statusCheckRollup,createdAt,additions,deletions
gh pr view <n> --json body,comments,reviews,statusCheckRollup   # per PR
# unresolved review threads:
gh api graphql -f query='query{repository(owner:"<o>",name:"<r>"){pullRequest(number:<n>){reviewThreads(first:100){nodes{isResolved path line comments(first:20){nodes{author{login} body}}}}}}}'
```

- **Dedupe first.** PRs that address the same issue or overlap heavily in diff are duplicates: spawn one subagent to compare them and recommend a **winner** (completeness, test coverage, greenness, code quality). Port any clearly superior pieces from the loser into the winner, then close the loser with a comment naming the winner and why. Never process both.
- **Queue order:** (1) dependency order — a PR based on another PR's head branch goes after its base; (2) closest-to-merge first (green CI, fewest unresolved threads); (3) oldest first as tiebreak.

Post the queue — one line per PR with its planned action (merge / close-duplicate / flagged: reason) — before starting Phase 2.

Completion: every open PR is in exactly one bucket — queued, flagged (draft / promotion / blocked), or close-as-duplicate.

## Phase 2 — Per-PR cycle

Run the full cycle for each queued PR in order. After every merge, `staging` has moved — the next PR's cycle starts again at Sync.

1. **Sync** — `gh pr checkout <n>`; if behind, merge `origin/staging` into the branch and resolve conflicts; push. Confirm `git branch --show-current` is the PR branch before any commit.
2. **Resolve comments** — one resolver subagent handles every unresolved thread and PR-level comment: verify against the code first; fix valid findings with the **minimal** change (one commit per addressed comment — mechanical fixes may go through the codex-implementation skill); decline false positives and gold-plating with a one-line written reason; reply to each thread and resolve it; push.
3. **Panel** — run the `pr-review-panel` workflow (`.claude/workflows/pr-review-panel.js`) with `args: {pr, base, head}`. It runs a gpt-5.6-sol (codex) reviewer and a fresh Claude reviewer in parallel, then a single adversarial verifier that dedupes and confirms — only **confirmed** findings come back. Fix them (codex-implementation for mechanical work), commit, push. If the fixes were substantial, re-run the panel once; **max two rounds** — remaining low-severity nits after round two are judgment calls recorded in the report, not new rounds.
4. **Gate** — `pnpm lint` + `pnpm typecheck` + focused tests green (read real output, not piped exit codes); `gh pr checks <n> --watch` until green; give CodeRabbit up to ~10 min to land if it reviews this PR, then triage its comments like step 2. Never merge on red.
5. **Merge** — squash (matches `staging` history: one commit per PR); title `<type>: <imperative, lowercase>` under 70 chars:
   ```bash
   gh pr merge <n> --squash --delete-branch
   ```

Completion per PR: merged, or parked with a written blocker. A parked PR never silently blocks the queue — record the blocker and move on.

## Phase 3 — Report

One compact table: PR · action taken (merged / closed-duplicate / parked / flagged) · comments fixed vs declined · panel rounds and confirmed findings · blockers. Flagged promotion PRs get an explicit "awaiting your call" line.

**Leanness rule.** Subagents return structured summaries under ~200 words (files touched, decisions, verdicts, blockers). The conductor never reads full diffs or issue bodies into its own window — if a subagent starts dumping a diff, tell it to summarize.
