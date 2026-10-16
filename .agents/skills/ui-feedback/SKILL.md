---
name: ui-feedback
description: Capture a user-led DMRV UI walkthrough as visual evidence and actionable GitHub issues, refine an existing issue, or prepare a designer handoff and reviewable visual proposals.
---

# UI Feedback

Turn spoken or written UI observations into an issue that preserves the problem,
evidence, and decisions. Follow `.claude/CLAUDE.md` and `CONTEXT.md` for project
language. Capture and refinement are entry routes; implementation is a separate
handoff to [implement-ticket](../implement-ticket/SKILL.md) when requested.

## Choose the entry route

Infer the route from the request; clarify only consequential ambiguity:

- **Problem only:** capture what is difficult, the user's intended outcome, and
  impact. Keep solution questions open; a useful issue need not prescribe a UI.
- **Proposed direction:** record the problem separately from the user's idea.
  Mark the proposal pending, selected, or rejected with the decision source.
  Suggesting an idea does not approve it for implementation.
- **Designer handoff:** prepare the current flow, constraints, evidence, open
  questions, and desired outcomes for design work. Record supplied designs and
  their decision status; a handoff alone does not make the ticket Ready.

Any route can start from an existing issue. Read its body, comments, linked PRs,
and board state before capturing more; preserve earlier decisions and evidence.

## Capture the walkthrough

Read [visual evidence](references/visual-evidence.md) before capturing or
publishing. Establish who controls navigation and the relevant environment.
In a user-led walkthrough, observe and capture the user's current state without
clicking, navigating, or launching a replay worker into their session. Tie each
observation to a numbered capture and the exact action/state being discussed.
If the moment was missed, record that gap; a later replay is a separate source.

Keep a compact local ledger in `.scratchpad/ui-feedback/<session>/`: observation
ID, user's concern, actual behavior, desired outcome, route/steps/state,
evidence IDs, proposed direction if any, and unresolved questions. Avoid
interrupting spoken feedback with a question for every remark; resolve ambiguity
at a natural pause. Record only speech/text actually available to the session.

For agent-led replay or local verification use
[codex-computer-use](../codex-computer-use/SKILL.md), including its session-mode
limits and fallback. Scope it to the relevant flow and use a separate session.
Read and judge its captures and report yourself.

Completion: each concern has evidence tied to its state, or an explicit capture
gap, and the user's observation is distinguishable from the agent's inference.

## Refine and file

Group observations by user outcome and acceptance criteria, not merely by page.
Search `Maji-Studio/noma-dmrv` issues (open and closed) and relevant PRs before
creating anything. Read plausible matches and their discussion. Enrich a
matching issue with a dated walkthrough update; preserve its history, selected
direction, and unresolved disagreements. For a closed match, check whether this
is a recurrence or distinct scope before deciding to reopen or link a new issue.
Do not close duplicates or reopen tickets merely to record feedback.

Use the [issue outline](references/issue-outline.md) for filing, refinement, or
a designer handoff. Draft locally when the request is capture-only; file/update
when requested or already authorized. Invocation to capture feedback alone does
not authorize posting comments, assigning designers, or changing board fields.

For authorized board changes, read the **Project board** section of the
[implement-ticket playbook](../implement-ticket/references/playbook.md).
Reuse its existing project and item lookup, verify live fields/options, and use
board Status and Priority fields, never status/priority labels or a new board.
New captured/unresolved work belongs in **Backlog**. Use **Ready** only when the
behavior, scope, acceptance criteria, and any material design choices are
resolved and required visual evidence is reviewer-accessible. Record unresolved
questions explicitly. Preserve existing Priority unless a change is authorized;
if ranking is unknown, leave it unset and report that. For an existing item in
progress/review, flag newly blocking questions rather than silently regressing
its status. Implementation retains the playbook's **In progress** and
**In review (Maji)** transitions.

Completion: return issue links (or local drafts), observation-to-issue mapping,
verified board state, decision status, and outstanding evidence/questions.
Report failed writes separately; never claim an issue or board update succeeded
without reading back the result.

## Explore a direction when useful

For a meaningful unresolved design choice or a request for options, develop up
to three distinct visual proposals with a short tradeoff and the question each
answers. A trivial fix may need one annotated direction or no variants.
Read `docs/design-system.md` and `docs/ux-writing.md` before designing. Reuse
[prototype](../prototype/SKILL.md) when a runnable UI/state exploration would
help; capture each relevant proposal state as a static image for issue review.
Label these **concept/prototype**, separate from observed application behavior.
Publish the images using the visual-evidence reference; a prototype link alone
is insufficient. Record the selected option and who selected it, or keep the
choice pending and the issue in Backlog. Designer delivery and prototype
completion are evidence of a proposal, not automatic approval.

When implementation is requested and the issue is sufficiently refined, pass
implement-ticket the original before evidence, selected direction and decision
source, acceptance criteria, remaining nonblocking questions, and comparable
capture conditions. Keep original evidence intact through the after comparison.
