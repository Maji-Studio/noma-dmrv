# Interface / Content QA Pass — 2026-06-14

Operator-focused interface, content-clarity, and form-layout QA on branch
`fix/visual-improvements-details`. Lens: a real biochar **facility operator** who
is **not** an engineer and does not know Isometric registry internals.

**Distinct from** the same-day data-integrity / authorization pass
(`docs/archive/2026-06-14-data-integrity-authz-qa-pass.md`) — this pass is about
copy, labels, helper text, validation messages, empty states, field grouping,
and cross-app terminology consistency, not data correctness or authz.

## Method

- **Browser verification**: authenticated session against local
  `http://localhost:3100`, full-page screenshots of ~20 main routes at desktop
  (1440px) and a narrow mobile viewport (390px), plus create-form deep links
  (`?create=true`). Real seeded facility (`97ca31c2…`).
- **Source inventory**: four parallel read-only agents swept the certification,
  core-entity, distribution/credit, and dashboard/energy/CoC copy. ~74 raw
  findings.
- **Triage rule** (per `.claude/CLAUDE.md`): every finding verified against the
  actual code **and** against the `CONTEXT.md` glossary before acting. Canonical
  terms were kept, not "simplified" away. In-flight files (being edited on this
  branch by parallel work) were **not** touched.

## Changed (applied this pass)

All edits are copy/label/helper/grouping only — no behavior change.

### Production-run form (`src/components/production-runs/production-run-form.tsx`)
- `Residence (min)` → **`Residence Time (min)`** (label dropped the metric).
- Added ⓘ hints to the four energy buckets explaining what each covers
  (`Startup / Plant Diesel`, `Genset Diesel`, `Preprocess Fuel`, `Electricity`).
- **Cross-app consistency**: `Diesel Ops (L)` → **`Startup / Plant Diesel (L)`**
  and `Diesel Genset (L)` → **`Genset Diesel (L)`** so the form labels match the
  Energy summary (`energy-summary.tsx`) and `CONTEXT.md` for the same DB columns
  (`dieselOperationLiters` / `dieselGensetLiters`).
- Added an **"why it matters"** note to the Output & Energy section: values feed
  the certification emissions calc; enter `0` if none used (blank ≠ zero) — the
  section silently requires all of them for cert-completeness.
- Dry-mass formula readout `× (1 − 15.00%)` → `× (100% − 15.00% moisture)`
  (the old form read as "1 minus 15").

### Certification
- `ghg-statement-create-drawer.tsx`: drawer subtitle `Period-first — Isometric
  links removals by date range` → **`Pick a reporting period — Isometric links
  the removals completed inside it`** (dropped the internal "Period-first" term).
- Overlap validation error rewritten to explain *why* (`Reporting periods can't
  overlap — pick an end date after …`).
- Production-confirm error `Confirm production submission to continue` → explicit
  `Tick the box to confirm this submits to the live production registry.`
- `ghg-statement-submit-dialog.tsx`: added always-visible helper text to
  **Report URL** ("Link to the published PDF report the verifier will open.") and
  **Summary of changes** ("What you changed since the last submission, for the
  verifier.") — the screen has none, and it's the last step before submitting.

### Core entities
- `operators/operator-form.tsx`: `Credentials` (reads like *login* credentials) →
  **`Role / credentials`** + concrete placeholder + ⓘ hint.
- `samples/sample-form.tsx`: Organic Carbon helper `C_org for stability
  calculations` → **`Used to estimate biochar durability.`** (label already says
  "Organic Carbon").
- `facilities/facility-form.tsx`: durability hint — removed the undefined **PDD**
  acronym and tightened the inherit/locked wording.

### Distribution
- `orders/order-form.tsx`: `Delivery Location` → **`Customer location`** (the
  field selects a `customerLocationId`; matches `CONTEXT.md`).
- `customers/customer-location-form.tsx`: distance helper `… for certification
  transport.` → **`… used for transport emissions.`** (dropped jargon).
- `credit-batches/credit-batch-list.tsx`: delete-confirm copy `… remove all
  associated application links` → copy that states **the applications survive**
  and can be re-linked. Verified against `deleteCreditBatch`
  (`data-access/credit-batches.ts`): only the `creditBatchApplications` join
  rows are deleted, not the applications.

## Verified in browser (desktop + mobile)

- Production-run create form renders cleanly desktop + mobile; KPI cards stack,
  empty state + CTA correct on 390px.
- Energy page **already** clarifies scope ("All production runs" on each card,
  "Facility energy use feeding Isometric submission datapoints" subtitle) — the
  source agents' "add scope/time" findings were **rejected** as already covered.
- Certification settings, GHG-statements, removals routes gate correctly when a
  facility has no registry link (consistent with the data-integrity pass).

## Rejected findings (kept canonical per CONTEXT.md)

Verifying against the glossary overrode several agent suggestions:
- **"Conversion loss"** — canonical (expected process physics); do **not** rename
  to "process loss / waste".
- **"Verifier"** — canonical (a GHG Statement is submitted to a verifier, not the
  registry); not jargon to remove.
- **"Reactor-day CSV" / "PLC"** — canonical ("reactor-day file", "PLC logger");
  the readings helper was left as-is.
- **"Removal"**, **"Reporting period"**, **"Isometric derives the start"** — all
  canonical and correct.
- Evidence-method labels "Visual proof" / "Boundary records": the agent's quoted
  strings/line numbers did not match the actual form — not applied (unverifiable).

## Deferred — needs design work

- **Dashboard KPI labels** (`src/data-access/dashboard-overview.ts`): "Feedstock
  processed", "Biochar produced" (no `t dry` qualifier), "Pyrolysis yield",
  "Applied to soil", "CO₂e stored". Several are real clarity/units gaps **but the
  file is in the parallel branch's in-flight working set** — apply after that
  settles to avoid clobbering. "CO₂e stored" framing also needs a product call
  (see issues).
- **Mobile nav**: on the 390px production-runs capture, the user-avatar circle
  overlaps the search input at the left edge — possible fixed-position/z-index
  issue in the mobile shell. Navigation is under parallel edit; diagnose
  separately.
- **Biochar-product form** (`biochar-products/biochar-product-form.tsx`): the
  run → mass → bin flow is implicit; would benefit from explicit `FormSection`
  framing ("Where did this biochar come from?" → "How much?" → "Where to?").
- **Facility GPS error** (`schemas/facilities.ts`): "Both latitude and longitude
  required" could target the specific missing field.
- **Reactor sampling-method helper** (`reactors/reactor-form.tsx`): Method B
  30-sample-minimum message presumes protocol knowledge; add a stable
  explanatory helper.
- **"Advanced binding → Certification Settings"** link
  (`facility-isometric-connector.tsx`): admin-only; "binding" is borderline
  domain term — reword once confirmed.

## Needs product / domain decision

- **Dashboard KPI labels / "CO₂e stored" framing** → filed as **#260**
  (operators store biochar not CO₂e; `t` vs `t dry` units; "Feedstock
  processed" / "Pyrolysis yield" / "Applied to soil" wording). Deferred because
  `dashboard-overview.ts` was in the parallel branch's in-flight set.
- **Vehicle fuel-consumption unit** (`schemas/quick-add.ts`): the main vehicle
  form is correct (L/100km, max 1000, converts via `lPer100KmToLPerKm`). The
  **quick-add** path stores `fuelConsumptionLPerKm` with `.max(10)` and relies on
  the dialog converting L/100km→L/km *before* validation — verify the
  convert-then-validate order so a realistic entry (e.g. 40 L/100km) isn't
  rejected.
