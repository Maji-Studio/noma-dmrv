---
name: implement-ticket
description: Autonomously carry a GitHub issue or plan from brief to resolved review comments, delegating each phase to a subagent so the main thread stays lean.
argument-hint: "<issue number | issue URL | plan file path>"
disable-model-invocation: true
---

Drive a ticket end-to-end. The main thread is a **conductor**: it resolves the target, then hands each phase to a subagent and keeps only their compact returns — it never reads code, diffs, or issue bodies into its own window. That is the point. A full cycle should cost the main context a few thousand tokens, not tens of thousands.

Read [`references/playbook.md`](references/playbook.md) for the concrete board IDs, `gh` commands, verification recipes, and subagent prompt skeletons. Pull from it as you spawn each subagent. gpt-6-astra implementation and UI verification use **codex-implementation** and **codex-computer-use** (`.claude/skills/codex-*/SKILL.md`). PR review uses [pr-review-suite](../pr-review-suite/SKILL.md). Point subagents at those skills instead of restating invocation mechanics.

**Leanness rule.** Every subagent returns a structured summary under ~200 words (files touched, decisions, test result, blockers). If one starts dumping a diff or file contents back to you, that is a failure — tell it to summarize. Spawn phase subagents synchronously (you need each result to proceed); Phase 4 delegates independent practices/models to the review suite.

**Guardrails.** `pnpm` only. Never commit to `staging`/`main` — feature branch + PR only. Secrets never enter the skill, a commit, or a log; the Chrome login reads `.env.local` at runtime. Report unavailable verification/review tools honestly; the review suite owns its all-models publication gate. Leave PRs draft; marking ready or merging requires a separate request.

## Phase 1 — Brief

Resolve the **target**: an issue (`gh issue view <n> --json title,body,comments,labels,url`) or a plan file (read it). For UI feedback, check that behavior, acceptance criteria, and material design choices are resolved; preserve unresolved questions and return blocking choices for refinement before building. Confirm you are not on `staging`/`main`, then branch `<type>/<kebab-desc>` off `staging`. If the target is an issue on the board, move its item to **In progress** (playbook IDs).

Write a compact **brief** to the scratchpad — goal, acceptance criteria, in-scope paths, out-of-scope, branch name, how to verify in the UI. This is the `/handoff` the implementer works from: keep it tight and link the issue/plan by URL rather than pasting it.

For UI changes, read [visual evidence](../ui-feedback/references/visual-evidence.md). Include original before evidence, selected direction and decision source, capture conditions, and any evidence gaps in the brief. Capture a missing baseline before edits where possible; label replay evidence.

Completion: brief file written, feature branch checked out, board moved (if applicable).

## Phase 2 — Build & Verify (one implementer subagent)

Spawn ONE subagent with only the brief path, the repo root, and a pointer to `.claude/CLAUDE.md`. Its task:

- Implement the change through the layered flow (schema → data-access+guards → fn → hooks → components), reusing existing hooks/utilities. Per the model rubric in CLAUDE.md, bulk/mechanical briefs (clear-spec implementation, migrations, sweeps) may be delegated to gpt-6-astra via the **codex-implementation** skill — the subagent then owns inspecting the diff and verifying, and codex output is evidence, not authority. User-facing work (UI, copy, API design) stays with Claude.
- Keep `pnpm lint` and `pnpm typecheck` green — never trust exit 0 from a piped command; read the real output.
- Commit on the feature branch (conventional commits; body says *why*).
- **Verify the changed behaviour** per the playbook's UI verification section — the path depends on session mode. Interactive session: ensure the dev server is up on :3100 and delegate to the **codex-computer-use** skill (the user approves the full-access prompt); judge the screenshots + report yourself. Auto/unattended session: the permission classifier blocks codex full-access and credential extraction — write or extend a Playwright e2e spec (HTTP-auth fixtures) covering the flow and run it; do not attempt the codex path. Claude-in-chrome fallback per playbook (user signs in themselves in auto mode). For a backend-only change with no UI surface, exercise the relevant `pnpm test:e2e` spec or unit path instead and say which.

For UI changes, preserve the before images and capture comparable after evidence from the running app per the visual-evidence reference. Record observed versus expected, acceptance results, tested commit, and limitations; visual review supplements correctness tests.

Completion: change committed, lint+typecheck green, the changed behaviour observed working. Track capture/publication blockers explicitly; unavailable evidence is not a verification pass. If verify goes red, send the failure back to the same subagent (SendMessage) to fix — never open a PR on red.

## Phase 3 — Publish (one subagent)

Spawn a subagent to push the branch (`-u`), open a **draft** PR to `staging` with a title/body built from the commits + brief (`Closes #<n>` when there is an issue), then move the board item to **In review (Maji)** (playbook IDs). For UI changes, embed or link durable, reviewer-accessible before/after evidence and the selected direction per the visual-evidence reference. If publication is blocked, disclose it and hand off the prepared attachment package; local paths do not count as attachments. It returns the PR number + URL and evidence publication status.

Completion: PR open against `staging`, issue linked, board moved.

## Phase 4 — Review (PR review suite + CodeRabbit)

Delegate to a fresh subagent using [pr-review-suite](../pr-review-suite/SKILL.md)
with the PR number and brief/spec. Its deterministic orchestrator pins the base
and head, runs independent Standards, Spec, and Deep Correctness practices, and
publishes one updateable practice-first comment. Preserve its publication gate
and advisory scope; do not run the older standalone reviewer/comment paths.
Report failures without claiming a completed suite or publishing partial results.

CodeRabbit may also review the PR. Wait for its review or a bounded timeout
(~10 minutes), then proceed with available findings and report any absence.
Keep the PR draft even when a reviewer does not run on drafts.

Completion: suite comment and reviewed head recorded (or explicit failure),
CodeRabbit present or timeout noted. Findings remain advisory until Phase 5.

## Phase 5 — Resolve (one resolver subagent)

Spawn a FRESH resolver subagent with the PR number. This is a separate remediation pass, not part of the advisory review suite. For every finding in the suite comment and other reviews, including CodeRabbit:

- Verify it against the actual code first.
- Fix valid findings with the **minimal** change. Resist over-engineering: a fix that balloons scope is itself a smell to push back on, not follow.
- Decline false positives and gold-plating with a one-line written reason.
- Reply to each review thread; resolve the ones addressed or declined; leave genuinely open questions unresolved. For findings in the suite’s aggregate comment, post a separate remediation summary keyed by practice/finding; leave the marker-owned suite comment for the orchestrator to update.
- One commit per addressed comment; keep lint+typecheck green; push.

After later pushes, rerun pr-review-suite for the new head so its existing comment is updated. Refresh affected UI evidence after UI fixes. Triage new findings through this separate resolver; if a rerun repeats an already adjudicated finding without new evidence or remediation cannot progress, report it instead of cycling commits/reviews. Report unresolved questions or tool failures without marking the PR ready or merging.

Completion: every available finding triaged (fixed / declined+reason / explicitly unresolved), replies posted, addressed threads resolved, branch pushed if changed, suite status recorded for the current head.

## Phase 6 — Report

Emit one compact summary: issue/plan, branch, PR URL, board status, what changed, verify result, visual evidence/publication blockers, reviewed head and suite comment URL, review outcomes, comments resolved (fixed vs declined), and any unresolved findings. State that the PR remains draft. Nothing else needs to live in the main context.
