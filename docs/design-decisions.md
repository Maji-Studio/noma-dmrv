# Design decisions

This is the per-surface log of what we tried, what replaced it, and why. Read it before proposing a layout or pattern on a surface; never re-propose something listed under "Rejected". Add an entry when a pick or a reversal lands (date, what was tried, what replaced it, the issue or PR). The rules themselves live in `docs/design-system.md`, `docs/forms.md` and `docs/ux-writing.md`; this file holds the history.

## Cross-cutting

- **Casing** (#546, #848, #868; 2026-07-27 to 09-30): Title Case chrome and mono caps table headers → sentence case everywhere. Mono stays for the `PageHeader` eyebrow, codes and IDs; `.label-button` renders buttons in mono caps from sentence-case source text. Why: a half-converted family reads as drift ("consistency is king").
- **Simple and Detailed** (#821/#822 → #847; 2026-09-21 to 09-29): Simple hid derived blocks and some inputs → both modes show the same information, Detailed adds explanation only. Rejected: any "Add X" reveal or hidden step in Simple.
- **Certification marker** (#851 → #858, #1117; 2026-09-30, 10-16): seal glyph and a sheet legend → "CERT" text chip, no legend. A requiredness legend was rebuilt in #1117 and closed unmerged. Rejected: "Required for certification" text.
- **Typography layering** (#822; 2026-09-21 to 09-23): a layered typography import switched on unreviewed utilities app-wide → reverted; only `.font-medium` is overridden.
- **Stat card scope** (#690, #1279; 2026-10-20): "on this page" sums became whole-facility server totals; a failed stats load shows "Could not load" instead of 0. Rejected: page-scoped figures.
- **List-page subtitle** (#1245; 2026-10-20): "every list page gets a subtitle" → a subtitle stays only when it adds information the title lacks. Why: a subtitle that restates the title ("Orders" / "Manage your orders") is filler.
- **Form subgrid** (2026-07-24): `.grid > .form-field` subgrid → reverted; shorten labels instead.
- **Dialog actions** (#1150; 2026-10-17): right-aligned footers → bottom left, primary first, secondary after; refused delete is a dialog with "Archive instead" first.
- **Override controls** (#1123; 2026-10-16 to 10-18): the user asked for the override inside the input → reverted the next day ("it sucks what i proposed"): a secondary outline button next to the input, labelled "Reset to default"; "Refresh from location" is a compact action below the input that opens a dialog showing old → new.
- **Missing mass figure** (#1251; 2026-10-20, Kenji): two full-size "Not recorded" figures in the Biochar output stat card collided at 1440 px → each missing `MassPair` figure is small grey regular text with `data-empty`, both labels kept. Rejected: collapsing the pair into one line.
- **Value changes** (2026-09): sentences describing a change → two blocks with an arrow (before → after); unchanged readings ("30% → 30%") are not shown.

## Pickers and forms

- **Entity pickers** (#891 → #966, #997; 2026-10-01 to 10-14): View and Edit buttons beside the dropdown → Edit as a row inside the menu (opens a modal), search from 6 options, panel as wide as the field, left aligned. Native selects stay for short hard-coded lists.
- **Field rows** (#946 vs #951; 2026-10-13): Name and Category sharing a row → every dropdown on its own full row ("full row i'd say. infos first.").
- **Section headings** (#995): "Required information", "Additional information" → removed; section titles are optional, and read views follow the form.
- **Stock entries**: a "Correct entry" action on stock movements → rejected; correct the source form or use a named correction.
- **Production run status** (#991): Draft and Running on create → create as Running or Complete; Cancelled is an action.
- **Choice controls** (form cleanup, 2026-09-29): selector text → choice cards when the choice has a consequence, segmented controls for short equal options, selects for the rest.

## Onboarding

- **Setup wizard** (#500 → #940 → #965; 2026-07-22 to 10-13): wizard with Back and Skip → Continue only, back through the step header → wizard removed; setup runs from the dashboard guide through the normal create sheets.

## Certification settings

- **Removal template setup** (#1276, PR 2; 2026-10-20, Kenji picked variant B): the "Removal templates" pane listed every template with every component to review (103 open questions on the audit, Save about 5000px down) → a summary card in the pane plus a full-page setup (`/certification/settings/removal-template-setup`): step rail (Template, Decisions, Apply), a What happens aside that fills in as you decide, only templates that fit the facility offered, one line naming the rest. noma decides what it can; the page asks only what it cannot, and the other components stay folded with Change. One fit with nothing to decide opens on Apply. No recommended template: with several fits nothing is preselected. Owner and Admin are one level; Members see the card without buttons. Why it is not #965: that removed a multi-entity wizard with Back and Skip that duplicated the create sheets; this is one configuration task with 0 to 3 real questions, entered from the summary or a blocker, never gating first run, no Skip, and it stores nothing until Apply. Rejected: a checklist inside Settings (C) and a stepper dialog (A).

## Stock, bins and transport

- **Stock blocks** (PR 822 picks, #1001; 2026-09-23, 10-17): dry biochar headline → wet mass first, dry biochar below in a smaller, lighter line; correction previews show wet first.
- **Stock history**: timeline. Bin history (#1004): always wet mass, dry when available, the rest in the table, top to bottom on phones.
- **Bin sheet** (#992): titled cards, the bin figure is hoverable, one text action top right per card, ⓘ next to the title, one "Adjust stock" (lost mass) action. Rejected: "Record loss" and "Reconcile stock" buttons; stock history buttons outside the bin route.
- **Transport legs** (#892): derived transport on every record → transport only where goods move; route rail variant B, one line per leg with a menu, "View map" in a dialog. Rejected: two competing summary areas on the right.
- **Distance refresh action** (#1262; Kenji, 2026-10-20): the outlined uppercase "Refresh from location" button was "huge" → "text only with underline and a refresh icon before, so it fits into the row". The edit row and the read-view notice both use it. Rejected: the boxed button on the hint line.
- **Production run flow** (#888, #999): Sankey, left to right, with numbers; water taken up shown as an inflow.
- **Energy → Emissions** (2026-10-01 → #1140): toggled explorer (variant F) was "too complicated" → list and Sankey toggle (G) → replaced by Emissions: overview C, detail C3c (monthly ledger, whole row clickable, ⋮ menu), then accordion layout E (full width, line description above Source, comment as an action). Rejected: a "Nothing to record" button; default reads "Nothing recorded" with a quiet "Add manual entry".

## Removals

- **Empty components in New Removal** (epic #1058 PR 4, round 7; 2026-10-20, Kenji): empty template components confirmed on the submit step (A) or inside the compact batch boxes of selection (C, #1202) → version B, its own "Empty components" step between selection and Confirm & submit. One card per credit batch, "Add entry" per component (new tab), one optional note and "Record n components as zero", "Recorded zero" once confirmed, Undo on this step only. The step is skipped when nothing is empty; Continue refuses with a reason that names the components and batches; the submit step shows a read-only "Components sent" (value, source, files). Copy says "component", never "line" (2026-10-20). Rejected: confirming on the submit step, and the confirmation inside the selection boxes.

## Credit batches and locks

- **Credit batch line in forms** (#1164, #1059; 2026-10-20): Production Run form footer gets one quiet line above Save, credit batch icon, code linked in a new tab, ⓘ for the rule. Matched by the run's facility-local end day (#1099), not the start date of the Oct 15 prototypes. Running runs say "Expected credit batch"; a start-day stand-in says "by start day". Rejected: an "on save" suffix and a "What happens next" heading.
- **Credit batch page** (epic #1136; 2026-10-16): sheet-only → routed page with tabs, variant A, Overview first ("what needs me"). Progress label "Data complete 6" → "Missing data 6".
- **Credit batch overview**: card grid (kanban-like) and calendar → timeline with quiet bars, (+) slots in gaps defaulting to the rest of the month, applied mass in dry tonnes, hover cards only where they add information. Rejected: hovers that repeat a label or say "open batch page"; "Sampled" stats.
- **Locks** (#1101, #1134): ad hoc per-form locking → one rule (Open, In use, Sent); a locked record shows an informative box and no call to action it cannot take.
- **Status history** (#1074, #1146): popover on the status badge, timeline-like.

## Certification lists

- **Submitted on and Last synced** (#1105, #1281; 2026-10-20): the Removals and GHG Statements lists showed only a status, so a statement waiting for weeks looked like one sent today → "Submitted on" on both lists and "Last synced" on GHG Statements, each hideable with Columns, one line, sortable by date with undated rows last in both directions, and still searchable by the shown text. Removals date from the ledger submit. Statements date from the verifier submission (`submittedToVerifierAt`, the latest resubmission wins), not from the ledger row, which is stamped when the registry draft is created. Labels: "Not submitted" (no submission yet), "Submitted in Isometric" (past draft in the registry with no recorded date, whoever created it), "Never" (not synced). "Last synced" is the latest successful registry sync, recorded as one `ghg_statement:sync` event per statement; those events are left out of the submission history so they cannot push failed submits out of its window. Rejected: showing the ledger `submitted_at` for statements, and "Not available" for missing dates.
