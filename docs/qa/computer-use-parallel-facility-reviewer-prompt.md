# Parallel Facility B computer-use QA prompt

This is a companion to
[`computer-use-ux-reviewer-prompt.md`](./computer-use-ux-reviewer-prompt.md). Launch it
only after the primary reviewer has completed the local database reset and confirmed
the empty application. It must use an isolated browser context and must never reset
the database itself.

If the computer-use harness cannot provide an isolated browser/profile without
fighting for the same visible mouse and keyboard, run this prompt with an isolated
Playwright browser context or run it interleaved after the primary pass. Two GUI
drivers should not control the same desktop simultaneously.

```text
You are the companion Facility B QA reviewer for noma-dmrv. Another reviewer may be
building Facility A in the same local application and database. Your job is not to
repeat its general UX review. Your job is to find cross-facility isolation,
concurrency, context, cache, and workflow-consistency failures while independently
building a second facility through the real UI.

Repository:
/Users/kenji/Dropbox/Maji/18 Dark Earth Carbon/noma-dmrv

Application:
http://localhost:3100

Artifact directory:
<ARTIFACT_DIR_B>

Primary reviewer artifact directory, if provided:
<ARTIFACT_DIR_A>

IDENTITY AND DATA NAMESPACE

You are Reviewer B. Every record you create must be visibly synthetic and include the
unique marker “QA-B-<YYYYMMDD>-<short-run-id>” in its name, notes, or other safe
free-text field. Prefer ordinary auto-generated entity codes; do not force identifiers
the UI owns.

Facility A means any synthetic facility created by the primary reviewer that does not
carry your QA-B marker. Never edit or delete Facility A records except during the
explicit read-only access/isolation checks below.

MISSION

Build Facility B through enough of the operator chain to exercise Dashboard,
Chain-of-Custody, Credit Batch, Removal readiness, GHG Statement readiness, and
Certification Settings while Facility A is being populated. Verify that activity in
one facility never appears in, mutates, blocks, or silently changes the other.

This is a findings-only review:

- Do not edit source code.
- Do not open GitHub issues.
- Do not reset, migrate, seed, or directly mutate the database.
- Do not stop or restart the development server.
- Do not change organization-wide credentials, secrets, feature flags, or environment
  configuration.
- Do not submit anything to Isometric or another external registry/verifier.
- Do not delete Facility A or any Facility A record.
- Do not use real names, emails, addresses, or other PII.

READ FIRST

- .claude/CLAUDE.md
- CONTEXT.md
- docs/architecture.md
- docs/security.md
- docs/testing.md
- docs/design-system.md
- .agents/skills/qa/SKILL.md
- .agents/skills/codex-computer-use/SKILL.md
- docs/qa/computer-use-ux-reviewer-prompt.md
- Current docs/qa ledgers for known facility-context and deep-link failures

LAUNCH CONTRACT

1. Do not run pnpm db:reset. The primary reviewer owns the one authorized reset.
2. Confirm http://localhost:3100 is already available and serving this checkout. If it
   is unavailable or points at another checkout, stop and report the blocker. Do not
   start another server.
3. Confirm through the UI that the database is past reset and login works. Sign in by
   reading ADMIN_EMAIL and ADMIN_PASSWORD from .env.local. Never print, record, or
   screenshot them.
4. Use a browser profile/context isolated from Reviewer A. Record the browser/context
   strategy in the report.
5. Wait until the facility list is usable. It is acceptable to create Facility B
   before Facility A appears, but do not begin cross-facility assertions until one
   non-B synthetic facility is visible.
6. If the primary reviewer resets the database after you have started, stop. Record
   “coordination failure: reset occurred after companion launch”; do not recreate data
   repeatedly.
7. Write only to your own artifact/report paths. Never overwrite Reviewer A artifacts
   or ledger.

WHAT PARALLEL MEANS IN THIS PASS

The shared database and server are genuinely concurrent. Browser driving must still
be isolated and serial within your own context. Record an operation timeline with UTC
timestamps so failures can be correlated with Reviewer A later.

At meaningful checkpoints, refresh your view and note whether new Facility A activity
appeared where it should (global organization surface) or leaked where it should not
(Facility B-scoped surface). Do not coordinate exact click timing unless both reviewers
have a safe, explicit synchronization channel.

BASELINE: MAP SCOPE BEFORE TESTING

From CONTEXT.md and current code, classify relevant records/settings as one of:

- organization-scoped;
- facility-scoped;
- derived from facility-scoped records;
- global/admin-only;
- unclear.

Pay particular attention to feedstock types/catalogue entries, suppliers/customers,
storage, production processes/runs, documents, applications, credit batches, samples,
registry project links, durability, emission estimates, Removals, and GHG Statements.

Do not report shared organization-scoped data as leakage merely because it is visible
in both facilities. Do report it when the UI fails to explain the scope or lets the
operator attach a shared record in an invalid facility context.

PASS 1 — CREATE FACILITY B

Create Facility B through the real UI with:

- a clearly different name and physical location from Facility A;
- a different timezone if the UI/domain permits it;
- a different durability tier from Facility A if both choices are valid;
- clearly distinguishable notes and quantities;
- no registry submission.

Verify immediately:

- Facility B becomes the active facility only in Reviewer B's context.
- Facility A remains intact and is not renamed or reconfigured.
- Reviewer A's independent browser context is not expected to switch merely because
  Reviewer B selected Facility B.
- URL facility parameters, visible selector, page heading, and loaded data all agree.
- Refresh, back/forward, and direct navigation preserve B consistently.
- Dashboard and navigation do not briefly flash A data while B loads.

Capture a screenshot showing the active Facility B identity and URL without secrets.

PASS 2 — BUILD AN INDEPENDENT FACILITY B CHAIN

Using only the UI, build the current chain from CONTEXT.md far enough to create a
Credit Batch and its required Samples where the environment permits:

Facility B → Reactor → supplier/location → feedstock type/feedstock/storage →
production process/run → biochar product → customer/location → order → delivery →
application → Credit Batch → Samples.

Use quantities, dates, codes, and names visibly different from Facility A. At each
stage:

1. Confirm every dropdown contains only valid records for B plus intentionally shared
   organization-scoped records.
2. Confirm the UI explains shared versus B-specific choices where ambiguity matters.
3. Save the B record and verify it appears in B list/detail/Chain-of-Custody.
4. Switch to A and confirm the new B record is absent from A-scoped lists, counts,
   Quick Add results, dashboards, and graphs.
5. Switch back to B and verify the record remains selected and persisted.
6. Record any stale row, count, toast, selection, URL, or graph edge after switching.

Do not edit A records to make B's workflow easier. If a prerequisite is correctly
facility-scoped, create the B equivalent. If it is correctly organization-scoped,
test whether reuse is deliberate and understandable.

PASS 3 — CROSS-FACILITY CONTEXT ATTACKS

Run these tests with concrete A and B record IDs/codes:

A. Selector, URL, and displayed data agreement

- Open a B list/detail route with ?facility=<B> and hard-refresh.
- Change only the query parameter to A where the route supports it.
- Use back/forward after switching A → B → A.
- Open one A tab and one B tab in the same Reviewer B browser profile. Alternate
  between them and verify each tab's URL, selector, heading, rows, and actions remain
  coherent. If facility selection is intentionally profile-global, verify the UI
  updates safely rather than allowing a stale tab to mutate the wrong facility.

B. Cross-facility deep links / IDOR

- While B is active, navigate directly to a known A entity detail/edit URL by ID.
- Expected: fail closed, redirect to the correct scoped surface with an explicit
  explanation, or deliberately switch context with clear feedback. A silent A record
  display under a B header is a serious failure.
- Never save or delete the A record. Access checks are read-only.
- Repeat with a B entity while A is active.

C. Form opened before facility switch

- Open a new B form and enter clearly marked unsaved B data.
- Switch active facility to A before saving.
- Expected: the app blocks the switch, closes/resets the form with a warning, or keeps
  the form immutably bound to B and makes that binding obvious.
- Do not save if the destination facility is ambiguous. If the UI makes the binding
  explicit and safe, save and verify the record lands only in B.

D. In-flight mutation and stale cache

- On a low-risk B record, submit a save and immediately navigate/switch facility.
- Verify the success toast names the correct entity/facility when needed, the B cache
  updates, and no A list receives the B row.
- Return to B, hard-refresh, and confirm exactly one saved record.

E. Quick Add isolation

- Start a B form that needs a prerequisite and Quick Add a new B prerequisite.
- Verify it becomes selected in the originating B form.
- Switch to A and verify that facility-scoped Quick Add record is absent.
- For organization-scoped Quick Add data, verify its shared availability is expected,
  correctly labelled, and cannot carry a hidden B facility relationship.

F. Same human-readable values

- Where validation and the domain allow, create a B record with the same display name
  as an A record but a distinct QA-B marker in notes or secondary context.
- Verify dropdowns and search results provide enough facility/context information to
  distinguish them.
- Do not deliberately bypass a uniqueness constraint; record whether its scope and
  error message are understandable.

PASS 4 — DASHBOARD AND CHAIN-OF-CUSTODY ISOLATION

For A and B, compare:

- entity counts;
- outstanding actions/readiness gaps;
- mass totals;
- evidence gaps;
- DAG nodes and edges;
- Map markers/routes;
- Sankey quantities;
- links from graph elements to details.

Assertions:

- B totals derive only from B records.
- A changes do not alter B totals unless an explicitly organization-wide metric is
  labelled as such.
- No node, marker, quantity, name, code, or action from B appears in A's chain views,
  and vice versa.
- Switching facility never leaves an old graph, legend, selection, or side panel on
  screen under the new facility heading.
- Graph/detail deep links preserve the correct facility context.

Capture matched A/B screenshots for each Chain-of-Custody view using the same viewport.

PASS 5 — CERTIFICATION ISOLATION

A. Credit Batches

- Create or inspect a B Credit Batch and confirm its eligible runs, applications,
  samples, quantities, durability, certifier, and readiness derive only from B.
- While A is active, direct-link to the B batch. Verify the UI never displays the B
  batch under A context or lets an A action mutate it.
- Compare readiness messages across Dashboard, card, editor, and Removal flow for B.
- If A activity occurs during the check, refresh and verify it does not alter B's
  readiness.

B. Certification Settings

- Compare A and B settings without changing organization credentials.
- Verify facility project link, durability-derived settings, emission estimates, and
  actionable warnings are scoped correctly.
- Verify organization/environment health is presented as shared when it is shared,
  rather than duplicated as if separately configurable per facility.
- A project link, estimate, or warning belonging to A must not appear as B's value.

C. Removal / GHG Entry readiness

- Start from B's visible next action and proceed only to a local draft/preview or a
  correct fail-closed gate.
- Verify every included Credit Batch and derived quantity belongs to B.
- Confirm missing B prerequisites name B records and direct to B routes.
- Switch to A and confirm B's draft/readiness does not appear in A lists or counts.
- Never perform an external submission.

D. GHG Statement readiness

- Inspect B's empty/blocked/ready state where reachable.
- Verify A Removals cannot be selected for a B statement and B Removals cannot appear
  in A's statement.
- Verify covered periods, counts, status, and direct links remain facility-scoped.
- Never submit to a registry or verifier.

PASS 6 — CONCURRENT-USE AND RECOVERY SCENARIOS

Use the operation timeline to test:

- Reviewer A and B create different facility-scoped records at roughly the same time.
- B refreshes a list while A adds a record.
- B leaves a form open while A changes its own facility data.
- B signs out/in or hard-refreshes while A continues working.
- B opens the same organization-scoped catalogue item as A; make no conflicting edit
  unless the primary reviewer explicitly coordinates it.
- B observes whether cache invalidation, loading skeletons, toasts, and counts stay
  scoped.

Do not manufacture a destructive write conflict with Reviewer A. If a safe shared
record conflict test is desired, document it as a follow-up Playwright scenario using
two browser contexts and an explicitly disposable shared record.

PASS 7 — SAFE SECOND-FACILITY DELETION CHECK

Do not delete populated Facility B while Reviewer A is still running. Instead:

1. Create a third empty facility with marker QA-B-DELETE.
2. Keep B active in one tab and the disposable empty facility active in another.
3. Exercise the empty facility's deletion flow if the consequence is explicit and no
   external action is involved.
4. Verify deletion does not change, hide, or delete A/B records.
5. Verify both tabs recover to a valid facility/context and no stale deleted-facility
   route or selector value remains.

For populated B, inspect the deletion confirmation only. Record dependent counts,
blocked/archival behavior, and whether the UI explains the safe contract. Do not
confirm populated deletion during the companion run.

STOP CONDITIONS

Stop mutations and preserve evidence if:

- a second database reset occurs;
- the server/revision changes;
- A or B data disappears unexpectedly;
- a form's target facility is ambiguous;
- the UI proposes an external registry/verifier write;
- credentials/secrets appear in the UI, logs, URL, screenshot, or network evidence;
- the only next step would modify Facility A;
- isolated browser control is lost and two GUI drivers begin interfering.

EVIDENCE AND SEVERITY

Every finding must include route, active facility shown in selector/URL, record
ID/code, steps, expected versus actual, reproducibility, screenshot or safe
console/network evidence, impact, and suspected root cause file:line when confidently
traced.

Severity:

- P0: cross-facility unauthorized disclosure/write, destructive loss, secret exposure,
  or wrong external submission.
- P1: facility-scoping failure blocked only by luck/manual checking, cross-facility
  totals/readiness, serious data-integrity failure, or unsafe deletion.
- P2: stale context/cache, misleading selector/URL, wrong dropdown scope, or workflow
  disruption that has a recoverable workaround.
- P3: ambiguous scope labelling or localized context friction with low immediate risk.

Treat an organization-scoped record shown in both facilities as a UX finding only
when the scope is unclear; do not misclassify intended sharing as a security leak.

REPORT

Write the companion ledger to:
docs/qa/<YYYY-MM-DD>-qa-parallel-facility-b.md

Save screenshots/video under:
docs/qa/artifacts/<YYYY-MM-DD>-local-parallel-facility-b/

The report must contain:

1. Executive isolation verdict: Isolated / Material context risk / Unsafe.
2. Browser/context strategy and whether the run was truly concurrent or interleaved.
3. Repository revision, server identity, login/reset handoff, and operation timeline.
4. Facility A and Facility B identifiers, clearly excluding PII.
5. Scope map: organization vs facility vs global/unclear.
6. A/B stage and record inventory.
7. Cross-facility acceptance matrix covering selector, URL, lists, dropdowns, Quick
   Add, Dashboard, Chain-of-Custody, Credit Batch, Settings, Removal, GHG Statement,
   and deletion.
8. Findings ledger ranked by severity.
9. Detailed evidence for every P0–P2 and meaningful P3.
10. Cache/context-switch timeline for stale-state findings.
11. Artifact index with matched A/B screenshots.
12. Known-issue/duplicate mapping and blocked/not-tested scenarios.
13. Top three isolation fixes and the single riskiest cross-facility behavior.

Do not implement fixes, file issues, or merge your ledger into Reviewer A's report.
The coordinating human/agent will compare and consolidate both reports afterward.
```

## Recommended execution topology

- Start the primary prompt first and wait until its reset and empty-state confirmation
  are complete.
- Run the companion in a separate browser profile/context and artifact directory.
- Prefer an isolated Playwright browser context for the companion when the computer-use
  implementation controls the shared Mac desktop globally.
- If isolated concurrent control is unavailable, run this prompt interleaved after the
  primary creates Facility A. The two-facility assertions remain useful even without
  simultaneous clicking.

