# Form cleanup

**Owner:** Kenji Nguyen · **Status:** approved 2026-09-29; Phase 0 shipped, Phase 1 in progress · **Last reviewed:** 2026-09-30

Audit, patterns and decisions: [Noma form cleanup page](https://claude.ai/artifact/Mfd8PEovxmGWqBt9jMKh9C). Five code audits covered about 70 create, edit and read surfaces. gpt-6-astra cross-checked the result, and every refuted claim is listed on that page.

## Purpose

Make every form and read view calmer and easier to scan. That means fewer lines and text styles, explanations behind the ⓘ, choice cards where a choice has a consequence, and one consistent Simple/Detailed contract. Each step gets checked in the running app for spacing and layout, not only in code.

## Binding rules

### R1. Simple and Detailed show the same information (Kenji, 2026-09-29)

Simple and Detailed differ only in explanation. Neither mode hides something you fill in or something you read.

- **Forms:** every input, section and action (history links, uploads, add buttons) renders in both modes. So does everything that informs a decision: available stock, stock after the movement, matching bins, before → after previews, blockers and warnings.
- **Read views:** both modes show the same fields and sections.
- **Detailed adds only explanation:** how a figure was computed, meaning calculation rows, basis captions, formula or component provenance, and raw versus capped values.
- **No reveals for fillable fields either.** "Add lab values" or "Add contact details" style reveals are out. A field may still appear conditionally when an earlier answer makes it relevant, as with the cancellation reason, the over-allocation justification and the distance-override note. Height comes down through grouping, pairing and unit suffixes instead.

The code comment on `DetailedOnly` (`src/components/forms/form-detail-context.tsx`) already states this rule ("never fields, warnings or evidence editors"). The call sites drifted away from it. See the inventory in Phase 0b.

### R2. Decisions (recorded on the audit page)

1. ⓘ holds explanations. A short visible `cue` stays for units, limits and consequences, tagged by hand.
2. CERT becomes a 14px seal glyph on the label row, explained once in the sheet header. Missing and satisfied keep their colours.
3. The red asterisk stays on required fields, since about 62 of 225 fields are required. The 1000-year reflectance fields that miss it get fixed.
4. Choice cards only where the choice has a consequence: stock mode, sampling, durability tier, GHG report source, evidence method, source visibility. Segmented controls for short equal options: loss/count, storage type, run status, incident severity, packaging, field position mode, feedstock usage. Selects for everything else. A one-option enum becomes a fixed value.
5. A small monoline illustration set drawn in code, used only in choice cards, empty states and onboarding.
6. Samples: merge carbon, elemental and proximate into one section with unit suffixes. No fields hidden, per R1.
7. Actions that save on their own open in an action modal: the facility registry connector and Method B setup.
8. The PageHeader eyebrow stays at page level. The no-eyebrow rule applies inside forms, sheets and read views.
9. Output-bin tiles lead with the wet estimate.
10. Bugs first. Then the new primitives are piloted on loss/count and evidence method. Then one PR per family, with tests migrated in the same PR.

### R3. Existing form contract

`docs/design-system.md` "Form type, lines and spacing" stays in force. That means at most 4 text styles, lines only between different kinds of thing, and one spacing rhythm per level: `space-y-20` between sections, `space-y-16` inside one, `gap-12` for derived blocks, `gap-6` to `gap-8` for captions, and `mb-6` from label to control. Value changes show as before → after blocks, and stock UI leads with wet mass.

## Browser rescan

The rescan runs before any code changes (the baseline), after every family PR (that family only), and once at the end (everything).

### Environment

- Use a dedicated worktree off `origin/staging` with its own database, `noma_dmrv_worktree`. Copy `.env.local` and `.env.test` by name only, never `cp .env*`. Set `NEXT_PUBLIC_APP_URL=http://localhost:3105`.
- Seed with `pnpm db:reset` then `pnpm db:seed`, which builds the Mafinga demo through the real server actions. Every sheet then has realistic data, including split and mix bins, certified samples and a submitted removal.
- Run `pnpm exec next dev -p 3105` outside the sandbox, with `DISABLE_RATE_LIMIT=true`.
- Maps: headless Chromium on macOS has no WebGL2 (#801). Run the capture headed, or with SwiftShader, so maps render. Blank `NEXT_PUBLIC_MAPTILER_KEY` only when the map is irrelevant to the check.

### Instrument A. Capture harness (deterministic, rerunnable)

A Playwright spec, `tests/visual/form-capture.spec.ts`, runs only when `FORM_CAPTURE=1`. It is one `test()` that loops over a surface manifest, because the fixture signs in once per test.

- **Surfaces:** for each of the 16 entities, the list page, then the read sheet, edit sheet and create sheet. Plus every action modal: loss, count, correction, split order, moisture reset, archive facility, transport leg, supplier and customer location, GIS reference, quick-add dialogs, GHG create and submit steps, removal wizard steps, Method B setup, and the settings and onboarding panes.
- **States:** Simple and Detailed; empty and filled; with validation errors shown (submit an empty form once).
- **Viewports:** 1440×900, 820×1180 (tablet) and 390×844.
- **Output:** one PNG per surface, state and viewport, plus `geometry.json`.

`geometry.json` is measured in the page for each sheet body:

| Check | Flags |
|---|---|
| Text styles | Distinct size, weight, case and tracking combinations. More than 4 in a form fails. Any uppercase or tracked text in a form or read body fails. |
| Lines | Visible top and bottom borders inside the body. The allowed ones are sheet chrome, the FormSpine rail, the CompositionCard action row and control borders. |
| Rhythm | Gaps between sections, fields and label-to-control, flagged when off the 6/8/12/16/20/24 scale or inconsistent within one level. |
| Alignment | Control left edges per column, lone half-width fields, orphaned cards in a grid, labels wrapping to two lines next to one-line neighbours. |
| Overflow | Horizontal scroll, clipped text, anything wider than the sheet. |
| Prose | Count of visible helper captions and paragraphs. |
| R1 diff | Visible field labels, section titles and actions in Simple compared with Detailed. Any difference that is not an explanation block fails. |

The R1 diff also becomes a permanent Vitest guard. Every read-section builder, and every form in the sheet, renders at both levels, and the test asserts identical field labels, section titles and actions.

### Instrument B. Computer-use review (codex-computer-use, gpt-6-astra)

Per family, gpt-6-astra drives the running app like an operator doing real tasks:

- create a feedstock delivery split across bins
- record a loss and a count
- start and complete a production run
- create a blended product from a mix bin
- deliver, apply and submit

It judges spacing, hierarchy and scanability. It also covers what screenshots miss: tapping the ⓘ, keyboard order and arrow keys in choice cards, the sticky footer while scrolling, and the error state after submit. The app has no dark theme, so there is none to check. It reports findings with screenshots.

Auto mode denied `codex exec` with full access before. Either you approve these runs, or they run in a normal session (Q4). If neither happens, Instrument A plus the visual review below still cover spacing and layout.

### Instrument C. Visual review and cross-check

For each family, a Sonnet agent with the frontend-design skill reads the PNG set and `geometry.json` against R1 to R3 and a layout checklist:

- one reading line
- related pairs side by side
- no dead half rows
- consistent control heights
- cards sized to the sheet, not the viewport
- empty states use `EmptyState`
- the footer never covers content

gpt-6-astra then tries to refute each finding. Confirmed findings join the audit page as a Layout section, per family.

## Phases

Each PR's definition of done:

- lint, typecheck and Vitest pass
- the e2e specs touched by the PR are migrated and green
- the R1 guard passes
- the harness shows before and after pairs for that family, attached to the PR
- `geometry.json` reports no new violations
- the codex-computer-use pass for that family's flows is done (or skipped, with Q4 noted)
- docs are updated
- the review suite runs, capped at two rounds

### Phase 0. Baseline and correctness (4 PRs plus a scan)

- **0a. Bugs.** One PR:
  - verify-email circles (`w-16`/`w-8` resolve to 16px/8px here)
  - `DistanceCalcField` wraps its input in a `div`, so `describeChild` never links the helper and error
  - required asterisk missing on the 1000-year reflectance fields
  - CALC has a double tab stop
  - the routing message names an env var
  - one-option enums (fuel type, transport method) become fixed values
- **0b. Simple/Detailed contract (R1).** One PR. The inventory below, the guard test, and updates to `docs/design-system.md` and `docs/forms.md`. `DetailPanel` fields lose `detailedOnly`. Sections get an explanation slot instead.
- **0c. Copy sweep.** One PR: Title Case buttons and dialog titles become sentence case, across about 40 strings.
- **0d. Baseline scan.** No code. Build the harness (committed behind `FORM_CAPTURE`), capture everything, then run the visual review and the cross-check. It needs the 0b guard idea only as a report, so it can run in parallel with 0a to 0c.

R1 inventory, from the code on 2026-09-29 (`grep` for `detailedOnly|DetailedOnly|useSimplePresence|useFormDetailLevel`):

| Where | Hidden in Simple today | Verdict |
|---|---|---|
| `orders/order-read-sections.tsx:60-79` | Matching stock section, fulfillment status, delivery count | Data. Always show. |
| `orders/matching-output-bins.tsx:24` | Matching bins on the order form | Decision info. Always show. |
| `applications/application-list.tsx:752` | Dry biochar applied, a CERT field | Data, subject to Q1. |
| `applications/application-form.tsx:441,466` | Delivery summary and available kg | Decision info. Always show. |
| `credit-batches/credit-batch-view.tsx:326` | Applied biochar | Data. Always show. |
| `credit-batches/credit-batch-view.tsx:168` | Run wet/dry output on run rows | Data. Always show. |
| `credit-batches/credit-batch-view.tsx:331-350` | Raw and capped durability, cap applied, preview component and formula | Explanation. Stays Detailed; the result figure itself shows in both. |
| `biochar-products/product-read-details.tsx:137,150` | Dry biochar, ingredient dry solids | Q1. |
| `biochar-products/product-read-details.tsx:161` | Derived transport section | Data. Always show. |
| `forms/entity-select/entity-select.tsx:234` | Remaining mass in bin pickers | Decision info. Always show. |
| `storage-locations/output-stock-preview.tsx:54` | The whole stock preview (before → after) | Decision info. The headline and picture show in both; only the calculation rows stay Detailed. |
| `biochar-products/ingredient-mass-split.tsx:37` | Bin history link | Action. Always show. |
| `storage-locations/mix-pile-card.tsx:46` | Batch shares in a mix pile | Data. Always show. |
| `storage-locations/output-stock-form.tsx:102` | Original entry figures on a correction | Data. Always show, as before → after. |
| `biochar-products/biochar-product-form.tsx:113`, `forms/mass-moisture-fields.tsx:230` | Composition preview and split before any input | Fine. It's an empty state, not a mode. |
| `forms/composition-card.tsx`, `ui/moisture-split` | Detail rows and calculation | Explanation. Stays Detailed. |

### Phase 1. Primitives, piloted (3 PRs)

- **1a. `FormField`:** a `cue` prop, a `unit` suffix, and helperText always going to the ⓘ, after the 36 short helpers are classified. InfoHint becomes a toggletip: it opens on tap and keeps its 24px trigger outside the label. CERT becomes a glyph with a sheet-header legend.
- **1b. `ChoiceCardGroup` and `SegmentedControl`:** built on native radios with arrow-key roving, a selection mark beyond colour, container-aware columns and an art slot. Piloted on loss/count (segmented) and on the application evidence method (cards, replacing `RadioCardGroup`). The specs that drive those controls get migrated in the same PR. Trip type is out: #852 removes the One-way option, so every leg counts as a round trip.
- **1c. `Notice`, flat controls, and the EntitySelect popover:** `Notice` replaces 6 warning styles. Flat controls drop the inset shadow. The EntitySelect popover loses its per-row rules and switches to Phosphor.

### Phase 2. Family passes (5 PRs, at most 2 in parallel, each with its own worktree, database and port)

1. **Transport and feedstock chain:**
   - Distance gets a suffix, a sentence-case Estimate button and a source chip. The supplier default stays restorable.
   - The From → To pair in the leg dialog.
   - Supplier sections and the 5-column location table.
   - Feedstock type usage as a segmented control, and the import dialog merged into the form.
2. **Stock and samples:**
   - Storage type as a segmented control, and split/mix cards with drawings.
   - The feedstock loss form gets before → after blocks and reason chips.
   - Formulation gets one row per material.
   - The product Placement step merges into Source.
   - Samples: the merged analysis section.
   - Remove the per-row rules and fix the history styles.
3. **Production and site:**
   - Status as a segmented control, placed first.
   - Start and End rows.
   - Stock available beside wet mass.
   - The process flow on the read sheet.
   - Measurement and incident dialogs.
   - Reactor type as cards if they pass the height check in the sheet.
   - Facility groups, and the registry connector as a modal.
   - The archive impact as chips.
4. **Downstream:**
   - Application field position as a segmented control, evidence method icons, and the upload note moved to the ⓘ.
   - Customer form in two sections.
   - Credit batch sampling cards, Method B as a modal, and one cohort summary.
5. **Settings, admin, auth, onboarding:**
   - Defaults in two groups with cards and segmented controls.
   - Credentials show "Ends 1a2b · Replace".
   - Org rows get a status pill and a modal.
   - Members flattened.
   - A shared `AuthResult`.
   - Onboarding without inner eyebrows, and the welcome step as icon rows.

### Phase 3. Read views and certification chrome (2 PRs)

- Removal detail, GHG statement and customer detail move onto `DetailPanel`. That includes the customer detail table.
- The eyebrow sweep inside forms, sheets and read views. The PageHeader stays, per decision 8.
- The Removal submit step becomes one headline, 4 facts and one rule. The GHG period shows once, as a start → end strip.

### Phase 4. Illustrations and final rescan (1 PR plus a scan)

- About 10 monoline SVGs in `components/ui/illustrations/`: routes, split and mix piles, bin states, reactor types, a sample vial, an envelope.
- The full rescan with all three instruments.
- Update `docs/design-system.md` with sections on choice controls, Simple and Detailed, and illustrations. Then archive this plan.

### Review backlog (Kenji, 2026-09-30)

From the before/after review of Phase 0 and the Phase 1 checkpoints. Each item goes into the Phase 2 family named in brackets.

- **Simple is for fast data entry on a phone.** Someone entering data on a phone may not need the explanation, only the fields. That is why the toggle stays (Q3). It fits R1: Simple drops explanation, never data.
- **Available stock** [downstream]: order create, edit and read show available stock as a bar, legend, dry line, caption and history link. Show one total instead (≈ 200 kg wet). Tapping it opens a modal with the single bins, reusing the bin cards.
- **Delivery stock block** [downstream]: on the delivery read sheet, the stock bar, its legend, the wet mass row, the rule and the Stock history link read as a jumble. Regroup them into one block.
- **Blend bar** [stock]: drop the green "Total 100%." line. When the shares don't add up, show the gap in the bar itself (an unfilled remainder) and say what is missing. Also fix the create layout, where the lone volume share field sits right-aligned beside an empty column.
- **Process flow** [production]: every bar has the same width, so 1,000 kg in looks the same as 300 kg out. Scale bar length to mass, or find another proportional picture. Drop the inner timeline rail that runs inside the section spine (two timelines side by side).
- **Two-line labels** [transport]: labels such as "One-way distance to facility (per leg, km)" wrap beside the CERT mark and the ⓘ. Shorten them and move the unit into the `unit` suffix (1a), so no label wraps next to a one-line neighbour.
- **Trip type** goes away entirely (#852): every leg counts as a round trip, so there is no choice left to design.
- **Derived transport on the product read sheet** shows in Simple since #847. Check it on staging.

## Risks

- **Height.** Cards and suffix wrappers add height in 360 to 640px sheets. The harness checks every card group at the real sheet width before it merges.
- **Tests.** About 14 Playwright specs call `selectOption` on selects that change. Each moves in the PR that changes its control.
- **Hidden help.** Moving help into the ⓘ can hide things second-language operators need. The `cue` classification is reviewed by hand, and the codex pass checks tap access.
- **R1 makes some sheets longer.** Data that Simple hid now shows. Grouping, rather than hiding, keeps the sheets calm.

## Answered questions (2026-09-29)

- **Q1.** Dry biochar and dry solids are data. Read views show them in both modes as a secondary line under the wet figure. In form previews, the dry pair stays part of the calculation (Detailed).
- **Q2.** R1 is strict. There are no "Add X" reveals for fillable fields.
- **Q3.** Keep the global toggle. Settled 2026-09-30: Simple serves fast data entry on a phone.
- **Q4.** Kenji approves the codex-computer-use runs with full access.
