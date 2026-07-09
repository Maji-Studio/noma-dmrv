---
name: implement-ticket
description: Autonomously carry a GitHub issue or plan from brief to resolved review comments, delegating each phase to a subagent so the main thread stays lean.
argument-hint: "<issue number | issue URL | plan file path>"
disable-model-invocation: true
---

Drive a ticket end-to-end. The main thread is a **conductor**: it resolves the target, then hands each phase to a subagent and keeps only their compact returns — it never reads code, diffs, or issue bodies into its own window. That is the point. A full cycle should cost the main context a few thousand tokens, not tens of thousands.

Read [`references/playbook.md`](references/playbook.md) for the concrete board IDs, `gh` commands, verification recipes, and subagent prompt skeletons. Pull from it as you spawn each subagent. gpt-5.5 work (implementation, review, UI verification) goes through the **codex-implementation**, **codex-review**, and **codex-computer-use** skills (`.claude/skills/codex-*/SKILL.md`) — point subagents at those files for invocation mechanics instead of restating commands.

**Leanness rule.** Every subagent returns a structured summary under ~200 words (files touched, decisions, test result, blockers). If one starts dumping a diff or file contents back to you, that is a failure — tell it to summarize. Spawn phase subagents synchronously (you need each result to proceed); the Phase 4 reviewers are independent and run concurrently.

**Guardrails.** `pnpm` only. Never commit to `staging`/`main` — feature branch + PR only. Secrets never enter the skill, a commit, or a log; the Chrome login reads `.env.local` at runtime. Codex and CodeRabbit are best-effort — degrade gracefully if absent.

## Phase 1 — Brief

Resolve the **target**: an issue (`gh issue view <n> --json title,body,labels,url`) or a plan file (read it). Confirm you are not on `staging`/`main`, then branch `<type>/<kebab-desc>` off `staging`. If the target is an issue on the board, move its item to **In progress** (playbook IDs).

Write a compact **brief** to the scratchpad — goal, acceptance criteria, in-scope paths, out-of-scope, branch name, how to verify in the UI. This is the `/handoff` the implementer works from: keep it tight and link the issue/plan by URL rather than pasting it.

Completion: brief file written, feature branch checked out, board moved (if applicable).

## Phase 2 — Build & Verify (one implementer subagent)

Spawn ONE subagent with only the brief path, the repo root, and a pointer to `.claude/CLAUDE.md`. Its task:

- Implement the change through the layered flow (schema → data-access+guards → fn → hooks → components), reusing existing hooks/utilities. Per the model rubric in CLAUDE.md, bulk/mechanical briefs (clear-spec implementation, migrations, sweeps) may be delegated to gpt-5.5 via the **codex-implementation** skill — the subagent then owns inspecting the diff and verifying, and codex output is evidence, not authority. User-facing work (UI, copy, API design) stays with Claude.
- Keep `pnpm lint` and `pnpm typecheck` green — never trust exit 0 from a piped command; read the real output.
- Commit on the feature branch (conventional commits; body says *why*).
- **Verify in a real browser**: ensure the dev server is up on :3100, then delegate the run to the **codex-computer-use** skill (playbook: UI verification) — it signs in with the `.env.local` admin creds, drives the changed flow, and returns screenshots + a report the subagent judges itself. Fall back to the claude-in-chrome recipe (playbook) if codex is absent or errors. For a backend-only change with no UI surface, exercise the relevant `pnpm test:e2e` spec or unit path instead and say which.

Completion: change committed, lint+typecheck green, the changed behaviour observed working. If verify goes red, send the failure back to the same subagent (SendMessage) to fix — never open a PR on red.

## Phase 3 — Publish (one subagent)

Spawn a subagent to push the branch (`-u`), open a PR to `staging` with a title/body built from the commits + brief (`Closes #<n>` when there is an issue), then move the board item to **In review (Maji)** (playbook IDs). It returns the PR number + URL.

Completion: PR open against `staging`, issue linked, board moved.

## Phase 4 — Review (fresh reviewer + Codex + CodeRabbit)

Three reviews converge on the PR. Keep the reviewer **fresh** — never the implementer — so it stays unbiased. Run the first two concurrently:

- **Fresh reviewer subagent** — review the diff against the brief/issue and repo standards. Verify every finding against the actual code before reporting; false positives (even bogus P0s) are common here. Post ONE PR comment, signed as a session-local reviewer.
- **Codex** (best-effort) — a subagent runs a gpt-5.5 review via the **codex-review** skill (playbook) and posts the findings as a PR comment under a "Codex review (gpt-5.5)" heading, labeled as unverified — Phase 5 verifies every comment anyway. If the binary is absent or errors, skip and note it.
- **CodeRabbit** — auto-reviews PRs to `staging`. Wait for its review to land before Phase 5 (poll `gh pr view <n> --json reviews` until a coderabbit review appears or ~10 min elapse; proceed with what exists if it doesn't).

Completion: fresh review posted, codex attempted, CodeRabbit review present (or waited-out and noted).

## Phase 5 — Resolve (one resolver subagent)

Spawn a FRESH resolver subagent with the PR number. For every comment — fresh reviewer, codex, CodeRabbit alike:

- Verify it against the actual code first.
- Fix valid findings with the **minimal** change. Resist over-engineering: a fix that balloons scope is itself a smell to push back on, not follow.
- Decline false positives and gold-plating with a one-line written reason.
- Reply to each thread; resolve the ones addressed or declined; leave genuinely open questions unresolved.
- One commit per addressed comment; keep lint+typecheck green; push.

Completion: every comment triaged (fixed / declined+reason), replies posted, threads resolved, branch pushed.

## Phase 6 — Report

Emit one compact summary: issue/plan, branch, PR URL, board status, what shipped, verify result, review outcomes, comments resolved (fixed vs declined). Nothing else needs to live in the main context.
