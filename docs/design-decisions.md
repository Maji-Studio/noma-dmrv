# Design decisions

What we tried per surface, what replaced it, and why. Read the entries for a surface before proposing a layout or pattern there; never re-propose something listed under "Rejected". Add an entry when a pick or a reversal lands (date, what was tried, what replaced it, the issue or PR). The rules themselves live in `docs/design-system.md`, `docs/forms.md` and `docs/ux-writing.md`; this file holds the history.

## Cross-cutting

- **Casing** (#546, #848, #868; 2026-07-27 to 09-30): Title Case chrome and mono caps table headers → sentence case everywhere. Mono stays for the `PageHeader` eyebrow, codes and IDs; `.label-button` renders buttons in mono caps from sentence-case source text. Why: a half-converted family reads as drift ("consistency is king").
- **Simple and Detailed** (#821/#822 → #847; 2026-09-21 to 09-29): Simple hid derived blocks and some inputs → both modes show the same information, Detailed adds explanation only. Rejected: any "Add X" reveal or hidden step in Simple.
- **Certification marker** (#851 → #858, #1117; 2026-09-30, 10-16): seal glyph and a sheet legend → "CERT" text chip, no legend. A requiredness legend was rebuilt in #1117 and closed unmerged. Rejected: "Required for certification" text.
- **Typography layering** (#822; 2026-09-21 to 09-23): a layered typography import switched on unreviewed utilities app-wide → reverted; only `.font-medium` is overridden.
- **Form subgrid** (2026-07-24): `.grid > .form-field` subgrid → reverted; shorten labels instead.
- **Dialog actions** (#1150; 2026-10-17): right-aligned footers → bottom left, primary first, secondary after; refused delete is a dialog with "Archive instead" first.
- **Override controls** (#1123; 2026-10-16 to 10-18): the user asked for the override inside the input → reverted the next day ("it sucks what i proposed"): a secondary outline button next to the input, labelled "Reset to default"; "Refresh from location" is a compact action below the input that opens a dialog showing old → new.
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

## Stock, bins and transport

- **Stock blocks** (PR 822 picks, #1001; 2026-09-23, 10-17): dry biochar headline → wet mass first, dry biochar below in a smaller, lighter line; correction previews show wet first.
- **Stock history**: timeline. Bin history (#1004) is open: always wet mass, dry when available, the rest in the table, top to bottom on phones.
- **Bin sheet** (#992): titled cards, the bin figure is hoverable, one text action top right per card, ⓘ next to the title, one "Adjust stock" (lost mass) action. Rejected: "Record loss" and "Reconcile stock" buttons; stock history buttons outside the bin route.
- **Transport legs** (#892): derived transport on every record → transport only where goods move; route rail variant B, one line per leg with a menu, "View map" in a dialog. Rejected: two competing summary areas on the right.
- **Production run flow** (#888, #999): Sankey, left to right, with numbers; water taken up shown as an inflow.
- **Energy → Emissions** (2026-10-01 → #1140): toggled explorer (variant F) was "too complicated" → list and Sankey toggle (G) → replaced by Emissions: overview C, detail C3c (monthly ledger, whole row clickable, ⋮ menu), then accordion layout E (full width, line description above Source, comment as an action). Rejected: a "Nothing to record" button; default reads "Nothing recorded" with a quiet "Add manual entry".

## Credit batches and locks

- **Credit batch page** (epic #1136; 2026-10-16): sheet-only → routed page with tabs, variant A, Overview first ("what needs me"). Progress label "Data complete 6" → "Missing data 6".
- **Credit batch overview**: card grid (kanban-like) and calendar → timeline with quiet bars, (+) slots in gaps defaulting to the rest of the month, applied mass in dry tonnes, hover cards only where they add information. Rejected: hovers that repeat a label or say "open batch page"; "Sampled" stats.
- **Locks** (#1101, #1134): ad hoc per-form locking → one rule (Open, In use, Sent); a locked record shows an informative box and no call to action it cannot take.
- **Status history** (#1074, #1146): popover on the status badge, timeline-like.

## Open

- Monthly facility report (#1109) layout A, B or C; bin history (#1004); switch-template warning (#1144); submission history (#1148, proposed Fine / Stopped / Needs support); row links (#1130, the user wants the full row clickable).
