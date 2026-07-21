# Run 2 — Staging UX / operator-experience audit

Deep operator + UX review against **staging**, run AFTER
`run-1-staging-isometric-integration.md`. It reuses the synthetic facility and chain Run 1
built and reviews the real populated staging surfaces. It deliberately DROPS the
empty-start premise from the original base prompt — a true empty-state / first-impression
sweep requires a DB reset and belongs on **local**, not staging.

## Suggested invocation

Follow `.agents/skills/codex-computer-use/SKILL.md`: substitute the real artifact
directory for `<ARTIFACT_DIR>`, write the prompt below to that directory, and run Codex
with computer use from the repository root. gpt-5.6-sol drives every browser flow; opus is
used only where Isometric/registry interpretation is needed.

---

```text
You are the independent operator QA + UX reviewer for noma-dmrv, a biochar carbon-credit
MRV application. Work like a careful facility operator who is new to the product, not like
the developer who built it.

Repository (read code/docs only — do not edit):
/Users/kenji/Dropbox/Maji/18 Dark Earth Carbon/noma-dmrv

Application under test (REMOTE STAGING — not localhost):
https://staging.noma.maji.studio

Isometric sandbox registry (for any cross-surface consistency check):
https://registry.sandbox.isometric.com/account/certify/project/prj_1K9YJ33RKSBX9FFF/overview

Artifact directory:
<ARTIFACT_DIR>

Credentials will be supplied to you directly. Never print, screenshot, paste, or store
them. You are given the noma staging app login and the sandbox registry login.

PREMISE (read carefully — differs from the generic base prompt)
- This runs on STAGING, which CANNOT be reset. NEVER run any database mutation. There is
  no empty database and no first-impression empty-state sweep in this run — that belongs
  on local. Instead you review the REAL populated staging state, primarily the synthetic
  "QA-<date>" facility and full chain created by Run 1 (facility → … → Credit Batch →
  Removal → GHG Statement, with sandbox submissions already made).
- This is findings-only. Do not edit source code, open issues, commit, or create branches.
- Do not submit anything NEW to the registry unless a UX test genuinely requires it and it
  is a sandbox write; prefer exercising local draft/preview surfaces. Never touch a
  non-sandbox / production Isometric environment.

MODEL / TOOL ROUTING
- Drive ALL browser flows with gpt-5.6-sol via computer use.
- Use opus-4.8 ONLY for Isometric/registry interpretation (call the isometric MCP `how_to`
  first). Never use opus to click through the UI. Never use Haiku. pnpm only.

STEP 0 — LOG IN EVERYWHERE FIRST (halt if any login fails)
Establish and confirm authenticated sessions in the staging app and the sandbox registry
before doing anything. If either fails, STOP and report an environment blocker.

READ FIRST
.claude/CLAUDE.md, CONTEXT.md, docs/design-system.md, docs/forms.md, docs/architecture.md,
docs/security.md, .agents/skills/qa/SKILL.md, .agents/skills/codex-computer-use/SKILL.md,
existing docs/qa ledgers (spot regressions, avoid duplicates). Reproduce independently
anything you cite from an old ledger.

DESIGN PRINCIPLES (apply the distilled frontend-design lens)
- Ground each screen in its real subject, audience, and single job; do not reward generic
  dashboard patterns just because they look tidy.
- Treat structure as information: sections, cards, labels, ordering must express a real
  relationship or workflow.
- Treat words as interface: use the operator's vocabulary, plain active language, specific
  actions, and names that stay consistent across buttons, confirmations, toasts, statuses.
- Empty and failure states must explain what happened and give a next action.
- Spend visual emphasis sparingly; keep supporting surfaces quiet and disciplined.
- Maintain responsive behavior, visible keyboard focus, reduced-motion support.

NON-NEGOTIABLE REVIEW LENS — for every important screen answer:
1. What job is the operator trying to finish here?
2. Within five seconds, can they identify the record, its state, the blocker (if any), and
   the next action?
3. Does the first layer contain only what's needed to decide or act now?
4. Is secondary explanation available on demand without competing with the task?
5. Is essential information visible without hover? Tooltips may explain a term but must not
   hide blockers, requirements, values, or actions.
6. Does every card/section have one clear job, or is it only boxing content?
7. Are status, readiness, counts, quantities, and next steps consistent across list, card,
   detail, editor, dashboard, certification wizard — and the sandbox registry?
8. Does copy name what the operator controls, not an implementation detail?
9. Can the operator recover from an error without losing entered data or restarting?
10. Is the screen understandable at a narrow laptop/mobile viewport and by keyboard?

INFORMATION HIERARCHY for every improvement you propose:
- Layer 1 — act now: identity, meaningful status, blocking issue, primary action, and the
  few quantities needed for the decision.
- Layer 2 — inspect: composition, lineage, calculations, evidence, explanations, behind a
  clearly named disclosure/tab/detail view.
- Layer 3 — diagnose/administer: registry payload details, integration health, credentials
  state, allowlists, derived-factor internals — kept out of ordinary operator settings
  unless they require operator action.
Do not recommend an accordion/modal/tooltip by reflex. Name the user question the content
answers, whether it is essential, and the best layer for it. Prefer removing duplicated or
irrelevant content over merely hiding it.

PASS A — ROUTE + FLOW SWEEP (populated state)
Inventory every route under src/app/(app)/ and src/app/admin/ and build a visit checklist.
Visit each and check: bare strings, dead ends, contradictory CTAs, 404s, console errors,
layout failures, routes exposed that cannot be used, certification routes not gated. For
records that legitimately have no children yet, judge whether the empty/partial state
explains itself and offers the right next action.

PASS B — RE-WALK THE CHAIN AS AN OPERATOR
Using Run 1's synthetic facility (create ONE extra throwaway "QA-DELETE-<date>" facility
only for the deletion test in PASS D), re-walk the chain and record friction in the
operator's words: what they expected next, what made them hesitate, what they tried. Verify
success feedback only appears when the saved state is visible and durable; verify persistence
and date/number fidelity on reload.

PASS C — FOCUSED UX REVIEW
A. Credit Batch list/card — Can the operator tell what "Pending" means and resolve each
   certification gap without opening unrelated screens? Are blank derived values (e.g. CO2e)
   explained or do they make the card look broken? Are identifier, dates, feedstock/process,
   durability, weight, sample/readiness state, and primary action prioritized right? Does the
   card repeat detail that belongs behind Inspect? Is destructive deletion too adjacent to the
   main action or under-explained?
B. Credit Batch detail/editor — Review production runs, claimed inputs, durability, notes,
   registry/accounting. Identify content answering no immediate operator question, repeating
   another surface, or using protocol/implementation language without helping a decision. Test
   whether selected-run membership, applied quantity, remaining/unclaimed mass, sample status,
   and certification effect are understandable. Decide what should be summarized, disclosed, or
   removed from the first layer.
C. Removal / GHG Entry — Start from the Credit Batch's visible next action. Confirm every
   prerequisite is known before the final confirmation. Check the same missing item appears
   consistently on Credit Batch, Removal readiness, and submission confirmation, with a direct
   link to the exact fix location. Distinguish local estimate, registry-calculated value,
   preview, submitted value, and pending input in both copy and presentation. Verify
   back/reload/retry/double-click does not duplicate or lose the draft.
D. GHG Statement — Verify the operator understands which submitted Removals are included, the
   covered period, what the statement does, and whether it is reversible. Check empty, partial,
   ready, submitted, and failure states where reachable. Confirm the final confirmation
   summarizes consequences and introduces no new blocker earlier readiness screens omitted.
E. Certification Settings — Evaluate as an operator task, not a system-status dashboard. Can
   the operator immediately see the one configuration action they must take? Separate ordinary
   configuration from advanced integration diagnostics. Flag un-actionable info, repeated
   environment labels, internal terms, oversized empty cards, or technical health data in the
   first layer. Verify environment warnings are specific without dominating the page. Recommend
   the simplest task-based grouping; do not preserve a card merely because it exists.
F. Facility deletion and dependent data — Test two cases: (1) the extra empty
   "QA-DELETE-<date>" facility; (2) the populated Run-1 facility. Locate the deletion path and
   document current behavior. Before confirming deletion of the populated facility, inspect
   exactly what the UI says will happen; do NOT proceed if it would trigger an external
   registry write or if scope is ambiguous. Evaluate whether the design names the facility and
   consequence; inventories dependent records by meaningful category/count; distinguishes safe-
   to-cascade from submitted/immutable/externally-linked records that must block or follow a
   governed archival path; requires confirmation proportional to risk; prevents partial
   deletion/orphans; moves active facility context to a valid state afterward; and states
   whether the action is permanent, reversible, or an archive. Do not assume DB CASCADE is the
   correct product behavior — report the observed dependency model and recommend a safe contract.

PASS D — ADVERSARIAL + CONSISTENCY (UX-oriented)
Hypothesis-driven attacks across the flow: blank/whitespace-only fields; oversized text;
negative/zero/non-numeric/extreme quantities; out-of-range percentages/invalid totals;
timezone-edge dates then save/reload; duplicate/double submit; browser back/reload mid-flow;
switching active facility mid-form; direct-linking another facility's entity ID; narrow
viewport, 200% zoom, keyboard-only navigation, focus visibility, obvious contrast/label
problems. Build a cross-surface readiness consistency matrix across Dashboard, entity
list/card, detail/editor, Credit Batch, Removal, GHG Statement, and the sandbox registry —
every inconsistency is a finding.

EVIDENCE STANDARD — a finding is valid only with: exact route + record ID/code; reproducible
steps + input; expected vs actual; frequency or "observed once"; screenshot/video
timestamp/console line/safe network evidence; impact; known/duplicate status; source root
cause as file:line when confident; a concrete suggested fix. For UX findings ALSO include: the
operator's question the screen fails to answer; the unnecessary decision or cognitive burden;
the recommended information layer (1/2/3); and a specific simplification — remove, rename,
regroup, summarize, disclose, or add a direct next action. Do not use "unpolished",
"confusing", "too much information", or "make cleaner" as a complete finding — prove the
hesitation or error and specify what should change.

CLASSIFICATION
Severity — P0: security/privacy breach, destructive data loss, or incorrect external
submission. P1: core workflow blocked, serious data-integrity/certification risk, or unsafe
destructive behavior. P2: task completable only through substantial confusion, stale/
contradictory state, or inaccessible interaction. P3: localized friction/copy/hierarchy/
consistency with low immediate risk.
Type — Functional · Data integrity/certification · Security/authz · UX/IA · Accessibility/
responsive · Environment blocker (reported separately).

REPORT — write to:
docs/qa/<YYYY-MM-DD>-staging-ux-audit.md
Artifacts under:
docs/qa/artifacts/<YYYY-MM-DD>-staging-ux/
Do NOT commit, branch, or open issues. Screenshots must never contain app or registry
credentials. The report must contain:
1. Executive verdict: Ready / Usable with material friction / Production-blocking.
2. The single worst operator-experience gap.
3. Top five fixes in recommended order, with why each comes first.
4. Environment, revision, browser, and safety notes (confirm NO db mutation was run; note
   that empty-state review was intentionally out of scope on staging).
5. Stage checklist for the full chain, including blocked/not-tested states.
6. Findings ledger, most severe first, with detailed evidence for every P0–P2 and meaningful
   P3.
7. Design-debt section for Credit Batch, Removal, GHG Statement, and Settings, organized as:
   keep on first layer; move to inspect/details; move to advanced/admin; remove or rewrite;
   missing direct action.
8. Facility-deletion behavior and a recommended safe deletion/archive contract.
9. Cross-surface readiness consistency matrix (incl. the sandbox registry column).
10. Artifact index with paths and one-line captions.
11. Known-issue/duplicate mapping and open product decisions.

Finish with a short handoff telling product/design what to simplify first and telling
engineering which confirmed blockers need diagnosis. Do NOT implement fixes or file issues.
```
