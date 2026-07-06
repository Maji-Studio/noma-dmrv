---
name: qa
description: Full end-to-end QA walkthrough from an empty database — drive the whole entity chain in the browser as an operator, try to break it, and file the results as a findings ledger plus issues.
disable-model-invocation: true
---

# QA

Drive the real app end-to-end in the browser, from an **empty** database to the last link in the entity chain, as an **operator** would — then try to break it. The point is not a green checkmark; it is to surface the UX and engineering rot a developer never hits because they test the happy path on seeded data. Run the same process every time so successive passes are comparable.

**Scope.** Default is the deep adversarial pass below, and you only _document_ what you find — no code fixes. `/qa smoke` runs the happy-path walk (steps 1, 2, 4, 6) and skips the adversarial pass. Fix code only when the user asks.

## Rules that hold for the whole run

- **Serial browser.** One agent — you — drives Chrome. It is a single shared session; browser actions cannot be parallelised across agents. Everything that is _not_ clicking (reading code, listing issues, tracing a bug's root cause) is read-only work you **fan out** to subagents so the browser flow never stalls.
- **Operator lens.** Judge every screen as someone running a biochar facility who has never seen this app, not as its author. Is the next step discoverable? Are labels and units unambiguous? Does the ambient facility context carry through, or does the app make you re-pick it? A developer asks "did it 500?"; an operator asks "would I know what to do here?"
- **Instrument.** Keep the console and network panels under watch (`read_console_messages` / `read_network_requests`). An operator never sees a 500, a swallowed mutation, or a hydration warning — but those are exactly the engineering bugs this pass exists to catch. Record the happy-path walk (step 4) as a GIF so the human can replay it.
- **Evidence or it didn't happen.** Every finding carries a concrete repro: the route, the input, expected-vs-actual, and a screenshot or console line.

### Smells to hunt

These recur in this codebase; each is a bug when you see it, and the reasoning generalises:

- A form asking the user to **pick a facility** (or any value that should come from ambient context). Forms receive `facilityId` from `FacilityContext` — a facility field on a form is the smell.
- **Bare-text** empty / "select a facility" states instead of the `EmptyState` component. Cold-start is where an operator forms their first impression; a raw string reads as broken.
- A **detail page that ignores the active facility** selector, or that lets you deep-link by ID into another facility's row (facility-scoping / IDOR).
- Numeric fields turning `""` into `NaN`; `type="date"` fields shifting by a day across a save (UTC parsing).
- **Cert / removal routes visible before** the facility has a registry link — the gate should hide them.
- **Quick-Add** of a prerequisite entity that doesn't seed its dropdown afterward, so the thing you just made isn't selectable.

## Process

### 1. Fan out recon

Before touching the browser, launch three read-only subagents in one turn and wait for all:

- **Route inventory** — enumerate every route under `src/app/(app)/` and `src/app/admin/`; return a checklist of pages to visit with their URLs.
- **Chain cheat-sheet** — read `CONTEXT.md` for the canonical entity vocabulary and the current traceability chain (Facility → … → Credit Batch → Sample), then read the schemas / data-access / fn for each entity and return, per entity: required fields, validation rules, prerequisites. This is your "what correct looks like" reference and your attack list. Read the chain from `CONTEXT.md` rather than trusting this list — the chain is theirs to change, not this skill's.
- **In-flight work** — list open GitHub issues and open PRs/branches (`gh`) so step 7 doesn't file duplicates and you know what's already being fixed.

Done when all three artifacts are in hand.

### 2. Empty start

Get the app to a true zero state: dev server on port 3100 (`pnpm dev`), then `pnpm db:reset` to drop and re-push with no seed data. Log in and confirm you land on an empty dashboard.

⚠️ `db:reset` only re-ensures the `ADMIN_EMAIL` user. If the credentials you were given are a _different_ account, that user won't exist post-reset — surface this and ask which account to use rather than fighting the login.

### 3. Cold-start sweep

Visit **every** route from the inventory while the database is empty. Log each broken or bare empty state, each crash, each "select a facility" dead-end. Done when every route in the inventory has been opened at least once.

### 4. Operator walk

Create **one** brand-new facility and take it all the way down the chain through the real UI — using Quick-Add for prerequisites as an operator would, never reaching into the database. At each entity: cross-check the form against the cheat-sheet, create it, then confirm it actually appears where it should — in its list, on its detail page, and in the chain-of-custody views (DAG / Map / Sankey). Narrate the operator's-eye friction as you go. Done when the chain reaches a credit batch with a sample and every entity is verified in those three places.

### 5. Adversarial pass

Now try to break it. Decide the attack cases from the cheat-sheet _before_ testing, then run them across the flow. At minimum:

- Empty and whitespace-only submits; oversized strings; negative, zero, and non-numeric numbers; out-of-range percentages; ratios that must sum to 100%.
- Boundary and timezone-edge dates (save, reload — did the day shift?).
- Broken referential order: delete a parent that has children; hunt for orphans.
- Double-click submit (duplicate creates?); back-button and reload mid-wizard.
- Switch the active facility mid-flow, and deep-link to another facility's entity by ID — does data leak across facilities?

When a real bug surfaces, **fan out** a subagent to trace its root cause to a `file:line` while you keep testing — collect its report asynchronously; never block the browser on investigation. Done when the attack list has been exhausted across the flow.

### 6. Removals + GHG statement

Drive a removal submission and a GHG statement to completion — or to the point where they are _correctly_ gated / fail-closed. Note anything confusing about readiness-vs-submittable, missing-prerequisite messaging, or preview-vs-actual mismatch.

### 7. Findings ledger + decisions to issues

Write the findings to a dated ledger (`docs/qa/YYYY-MM-DD-qa-empty-start.md`) — a table ranked most-severe first: Area | Severity (P0–P3) | Type (UX / Engineering) | Repro | Expected vs. Actual | Root cause (`file:line` if known) | Suggested fix. Attach the GIF path and key screenshots.

For findings that need a **product or design decision** rather than an obvious fix, open GitHub issues — dedup against step 1, and fan out subagents to draft the bodies. Show the user before filing.

Close with a tight executive summary: the top five things to fix now, and the single worst operator-experience gap.
