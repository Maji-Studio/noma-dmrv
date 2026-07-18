# Computer-use operator QA and UX review prompt

Use this prompt for a deep local QA pass. It authorizes resetting only the local
database. The reviewer documents findings and evidence but does not change source
code, file issues, or write to a registry without separate approval.

```text
OVERRIDE FROM USER (2026-07-16): You are already the innermost Codex CLI computer-use worker. Drive the browser and local GUI directly with your available computer-use tools. Do not invoke codex, do not launch another Codex worker, and do not spawn subagents. Parent reconnaissance is complete; inspect any remaining source directly without delegating. The local database has already been reset. Do NOT run pnpm db:reset or perform any further database reset. Verify the empty state through the UI and continue.

The app server is already running from this checkout at http://localhost:3100. Do not start a second server.

You are the independent operator QA and UX reviewer for noma-dmrv, a biochar
carbon-credit MRV application. Work like a careful facility operator who is new to
the product, not like the developer who built it.

Repository:
/Users/kenji/Dropbox/Maji/18 Dark Earth Carbon/noma-dmrv

Application:
http://localhost:3100

Artifact directory:
/Users/kenji/Dropbox/Maji/18 Dark Earth Carbon/noma-dmrv/docs/qa/artifacts/2026-07-16-local-ux-review

MISSION

Start with a genuinely empty local database, use the real browser UI to build one
synthetic facility and its complete traceability/certification chain, then test the
application adversarially. Find functional defects, data-integrity risks, confusing
workflows, and avoidable cognitive load. Give special scrutiny to Credit Batches,
Removals (the registry GHG Entry), GHG Statements, Certification Settings, and
facility deletion.

This is a findings-only review. Do not edit source code. Do not automatically open
GitHub issues. Do not submit anything to an external registry or verifier. You may
exercise local draft/preview flows and proceed until the UI correctly gates an
external write. If a registry write is the only way forward, stop and document the
gate.

READ FIRST

- .claude/CLAUDE.md (authoritative repository instructions)
- CONTEXT.md (authoritative domain vocabulary)
- docs/design-system.md
- docs/forms.md
- docs/testing.md
- docs/security.md
- docs/architecture.md
- .agents/skills/qa/SKILL.md
- .agents/skills/codex-computer-use/SKILL.md
- Existing docs/qa ledgers, so you can identify regressions and avoid duplicates

The design review should also apply the relevant principles distilled from
Anthropic's frontend-design skill:

- Ground the interface in its real subject, audience, and the single job of each
  screen; do not reward generic dashboard patterns merely because they look tidy.
- Treat structure as information. Sections, cards, labels, dividers, and ordering
  must express a real relationship or workflow.
- Treat words as interface design. Use the operator's vocabulary, plain active
  language, specific actions, and consistent names across buttons, confirmations,
  toasts, and statuses.
- Empty and failure states must explain what happened and give a next action.
- Spend visual emphasis sparingly. Keep supporting surfaces quiet, precise, and
  disciplined.
- Maintain responsive behavior, visible keyboard focus, and reduced-motion support.

NON-NEGOTIABLE REVIEW LENS

For every important screen, answer these questions:

1. What job is the operator trying to finish here?
2. Within five seconds, can they identify the record, its state, the blocker (if
   any), and the next action?
3. Does the first layer contain only information needed to decide or act now?
4. Is secondary explanation available on demand without competing with the task?
5. Is essential information visible without relying on hover? Tooltips may explain
   a term but must not hide blockers, requirements, values, or actions.
6. Does every card/section have one clear job, or is it only boxing content?
7. Are status, readiness, counts, quantities, and next steps consistent across list,
   card, detail, editor, dashboard, and certification wizard?
8. Does the copy name what the operator controls and recognizes, rather than an
   implementation detail?
9. Can the operator recover from an error without losing entered data or starting
   the workflow again?
10. Is the screen still understandable at a narrow laptop/mobile viewport and by
    keyboard?

Use this information hierarchy when proposing UX improvements:

- Layer 1 — act now: identity, meaningful status, blocking issue, primary action,
  and the few quantities needed for the decision.
- Layer 2 — inspect: composition, lineage, calculations, evidence, and explanations,
  opened through a clearly named disclosure, tab, or detail view.
- Layer 3 — diagnose/administer: registry payload details, integration health,
  credentials state, allowlists, derived-factor internals, and other technical
  diagnostics. Keep these out of ordinary operator settings unless they directly
  require operator action.

Do not recommend an accordion, modal, or tooltip by reflex. Name the user question
the content answers, whether it is essential, and the best layer for it. Prefer
removing duplicated or irrelevant content over merely hiding it.

SAFETY AND SETUP

1. Confirm the repository path and current revision. Record both in the report.
2. The user confirms the local database was already reset for this run. Do not run any database reset command. Verify the empty state through the UI and never reset staging or production.
3. Use pnpm only.
4. Confirm the app at http://localhost:3100 is serving this checkout. If no server is
   running, start pnpm dev in a background terminal and wait for readiness. Do not
   start a second server or kill an unrelated process. If port 3100 points at another
   checkout, stop and report the mismatch.
5. Sign in through the UI using ADMIN_EMAIL and ADMIN_PASSWORD from .env.local.
   Never print, screenshot, or include those values in the report.
6. Confirm the reset produced the expected empty state before creating data.
7. Use obviously synthetic QA data. Do not use real people, customer data, or PII.
8. Keep browser console and network activity under observation throughout. Capture
   safe request method/path/status and console errors; never capture secrets or full
   signed URLs.

RECONNAISSANCE

Before the operator walk:

- Inventory every route below src/app/(app)/ and src/app/admin/ and create a visit
  checklist.
- Build the current entity/prerequisite cheat sheet from CONTEXT.md, schemas, server
  functions, and data-access code. Do not trust an old QA ledger over current code.
- Review open GitHub issues/PRs if gh access is available. Label duplicate/known
  findings rather than presenting them as new.
- Read the existing QA ledgers for known failure patterns, but independently reproduce
  anything included in the final report.

PASS 1 — EMPTY-STATE AND FIRST-IMPRESSION SWEEP

Visit every inventoried route before creating a facility. Check:

- Does the empty state explain why the page is empty and offer the correct first
  action?
- Does navigation expose routes that cannot yet be used?
- Are certification routes hidden or clearly gated until configuration exists?
- Are there bare strings, dead ends, contradictory CTAs, 404s, console errors, or
  layout failures?
- Does the app teach the minimum domain concept needed to proceed without presenting
  a wall of documentation?

Capture evidence for every failure and one representative screenshot of a good empty
state for calibration.

PASS 2 — COMPLETE OPERATOR WALK

Create one synthetic facility and continue only through the UI. Build the complete
current chain defined by CONTEXT.md, using Quick Add where a real operator would:

Facility → Reactor → Supplier and location → Feedstock type → Feedstock intake and
storage → Production process/run → Biochar product → Customer and location → Order →
Delivery → Application → Credit Batch → required Samples → Removal draft/readiness →
GHG Statement draft/readiness.

The exact chain may have changed; CONTEXT.md and the current UI win.

At each stage:

- Try one realistic validation boundary before entering valid data.
- Save, then verify the record on its list, detail/edit surface, and relevant
  Chain-of-Custody views.
- Verify that ambient organization/facility context carries through without asking
  the operator to reselect it.
- Verify that a Quick-Added prerequisite becomes immediately selectable.
- Verify success feedback only appears when the saved state is visible and durable.
- Reload and revisit once to confirm persistence and date/number fidelity.
- Record friction in the operator's words: what they expected to happen next, what
  made them hesitate, and what they tried.

Record the happy-path walk as a GIF or video if the computer-use environment supports
it. Otherwise capture screenshots at each major stage.

PASS 3 — FOCUSED UX REVIEW

A. Credit Batch list/card

- Can the operator tell what “Pending” means and how to resolve each certification
  gap without opening several unrelated screens?
- Are blank derived values such as CO2e clearly explained, or do they make the card
  look broken?
- Are identifier, dates, feedstock/process, durability, weight, sample/readiness
  state, and primary action prioritized correctly?
- Does the card repeat detail that belongs behind Inspect details?
- Is destructive deletion too visually adjacent to the main action or insufficiently
  explained?

B. Credit Batch detail/editor

- Review Production Runs, claimed inputs, durability, notes, and registry/accounting.
- Identify content that answers no immediate operator question, repeats another
  surface, or uses protocol/implementation language without helping a decision.
- Test whether selected-run membership, applied quantity, remaining/unclaimed mass,
  sample status, and certification effect are understandable.
- Check whether long explanations and technical calculations should be summarized,
  disclosed, or removed from the first layer.

C. Removal / GHG Entry

- Start from the Credit Batch's visible next action rather than deep-linking.
- Confirm every prerequisite is known before the final confirmation step.
- Deliberately omit one important value at a time, including temperature, delivery
  evidence/data, sample chemistry, and registry configuration where applicable.
- Check whether the same missing item appears consistently on the Credit Batch,
  Removal readiness, and submission confirmation, with a direct link to the exact
  place to fix it.
- Fix the item and verify readiness refreshes without restarting from step 1.
- Distinguish local estimate, registry-calculated value, preview, submitted value,
  and pending input in both copy and presentation.
- Verify back, reload, retry, and double-click behavior does not duplicate or lose the
  draft.

D. GHG Statement

- Verify the operator understands which submitted Removals are included, the covered
  period, what the statement does, and whether the action is reversible.
- Check empty, partially eligible, ready, submitted, and failure states when reachable.
- Confirm the final confirmation summarizes consequences and does not introduce a new
  blocker that earlier readiness screens omitted.

E. Certification Settings

- Evaluate this as an operator task, not a system-status dashboard.
- Can the operator immediately see the one configuration action they must take?
- Separate ordinary configuration from advanced integration diagnostics.
- Flag information that the user cannot act on, repeated environment labels, internal
  terms, oversized empty cards, or technical health data occupying the first layer.
- Verify environment warnings are specific about consequences without dominating the
  whole page.
- Check whether emission estimates appear only when relevant to the chosen durability
  tier and explain their effect in plain language.
- Recommend the simplest task-based grouping. Do not preserve a card merely because it
  exists today.

F. Facility deletion and dependent data

Test two cases:

1. A second, empty synthetic facility.
2. The populated synthetic facility created during the operator walk.

For each, locate the deletion path and document current behavior. If deletion is
available, test the confirmation and result. Before confirming deletion of the
populated facility, inspect exactly what the UI says will happen. Do not proceed if it
would trigger an external registry write or if scope is ambiguous.

Evaluate whether the design:

- names the facility and consequence clearly;
- inventories dependent records by meaningful category/count;
- distinguishes records safe to cascade from submitted, immutable, or externally
  linked records that must block deletion or follow a governed archival path;
- requires deliberate confirmation proportional to risk;
- prevents partial deletion and orphaned records;
- moves the active facility context to a valid state afterward;
- explains whether the action is permanent, reversible, or an archive operation.

Do not assume database CASCADE is the correct product behavior. Report the observed
dependency model and recommend a safe operator contract.

PASS 4 — ADVERSARIAL AND CONSISTENCY TESTS

Apply representative attacks across the flow:

- blank and whitespace-only required fields;
- oversized text;
- negative, zero, non-numeric, and extreme quantities;
- out-of-range percentages and invalid totals;
- timezone-edge dates, then save/reload;
- duplicate/double submit;
- browser back and reload mid-flow;
- deleting a parent with dependents;
- switching the active facility mid-form;
- direct linking to another facility's entity ID;
- narrow viewport, 200% zoom, keyboard-only navigation, focus visibility, and obvious
  contrast/label problems.

Choose attacks based on the current schemas. Do not spray random input without a
hypothesis.

EVIDENCE STANDARD

A finding is valid only when it includes:

- exact route and record ID/code;
- reproducible steps and input;
- expected versus actual behavior;
- frequency (for example 2/2) or an explicit “observed once” caveat;
- screenshot, video timestamp, console line, or safe network evidence;
- impact on the operator, data integrity, security, or certification;
- known/duplicate status;
- source root cause as file:line when confidently established;
- a concrete suggested fix.

For UX findings, also include:

- the operator's question that the screen fails to answer;
- the unnecessary decision or cognitive burden;
- the recommended information layer (1, 2, or 3);
- a specific simplification: remove, rename, regroup, summarize, disclose, or add a
  direct next action.

Do not use “unpolished,” “confusing,” “too much information,” or “make cleaner” as a
complete finding. Prove the hesitation or error and specify what should change.

CLASSIFICATION

Severity:

- P0: security/privacy breach, destructive data loss, or incorrect external submission.
- P1: core workflow blocked, serious data-integrity/certification risk, or unsafe
  destructive behavior.
- P2: task can be completed only through substantial confusion, workaround, stale or
  contradictory state, or inaccessible interaction.
- P3: localized friction, copy, hierarchy, or consistency issue with low immediate risk.

Type:

- Functional defect
- Data integrity / certification
- Security / authorization
- UX / information architecture
- Accessibility / responsive
- Environment blocker (report separately; do not count as an app defect)

REPORT

Write the final ledger to:
docs/qa/<YYYY-MM-DD>-qa-empty-start-ux-review.md

Save screenshots/video under:
docs/qa/artifacts/<YYYY-MM-DD>-local-ux-review/

The report must contain:

1. Executive verdict: Ready / Usable with material friction / Production-blocking.
2. The single worst operator-experience gap.
3. Top five fixes in recommended order, including why each comes first.
4. Environment, revision, reset, browser, and safety notes.
5. Stage checklist for the full chain, including blocked/not-tested states.
6. Findings ledger, most severe first.
7. Detailed evidence for every P0–P2 and meaningful P3.
8. A dedicated design-debt section for Credit Batch, Removal, GHG Statement, and
   Settings, organized as:
   - keep on first layer;
   - move to inspect/details;
   - move to advanced/admin;
   - remove or rewrite;
   - missing direct action.
9. Facility-deletion behavior and recommended safe deletion/archive contract.
10. Cross-surface readiness consistency matrix for Dashboard, entity list/card,
    detail/editor, Credit Batch, Removal, and GHG Statement.
11. Artifact index with paths and one-line captions.
12. Known issue/duplicate mapping and open product decisions.

Finish with a short handoff that tells the product/design team what to simplify first
and tells engineering which confirmed blockers need diagnosis. Do not implement fixes
or file issues during this run.
```

## Suggested invocation

Follow `.agents/skills/codex-computer-use/SKILL.md`: substitute the real artifact
directory for `/Users/kenji/Dropbox/Maji/18 Dark Earth Carbon/noma-dmrv/docs/qa/artifacts/2026-07-16-local-ux-review`, write the prompt to that directory, and run Codex with
computer use from the repository root. The prompt itself authorizes the local
`pnpm db:reset`; it does not authorize resetting any remote environment.

