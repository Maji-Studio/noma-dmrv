# Isometric changes archive: 2026-07-23 to 2026-07-24

Historical implementation and sandbox-verification notes for Isometric work
completed on 2026-07-23 and 2026-07-24. Read this when investigating the
decisions or registry observations behind the current implementation.

## 2026-07-24 (promotion review hardening)

- GHG Statement creation now fails before registry access when an Isometric
  project is shared across noma facilities. Registry sync also fails with an
  actionable error when one remote statement contains removals owned by
  multiple facilities; the current local statement model remains
  facility-scoped.
- Statement carbon totals use registry figures only when local, fetched, and
  remote GHG-entry ID sets match exactly. Unknown or stale remote membership
  degrades to the local estimate instead of presenting a partial sum as
  registry-derived.
- Credit-batch lifecycle rendering branches on stable status kinds rather than
  display labels, the overview's lifecycle query now lives in org-scoped
  data-access, and evidence readiness counts only complete managed-storage
  objects that pass the mirror flow's static metadata and storage-availability
  checks.

## 2026-07-24 (protocol re-pin 1.2 → 1.1 + durability tier resolution)

Operator decisions closing the two open questions raised by the same-day
version audit below:

- **Protocol re-pin (closes `isometric/project-protocol-version`).** The
  operator confirmed the Certify project's **v1.1** is authoritative and
  `versions.json` was re-pinned from v1.2 to **v1.1 (patch 1.1.1)**. The module
  set now follows protocol v1.1's references
  ([registry](https://registry.isometric.com/protocol/biochar/1.1)): storage is
  **Biochar Storage in Agricultural Soils v1.1** (`biochar-storage-soil-environments`
  exists only from protocol v1.2), **Biomass Feedstock Accounting v1.2**
  (not v1.3), and **GHG Accounting is unreferenced** by v1.1 (it enters with
  v1.2). `checkProtocolVersionAtSubmit`
  (`src/fn/certification/protocol-version-preflight.ts`) reads the pin from
  `versions.json`, so the submit preflight now expects "1.1".
  **Gap-check (same day):** the v1.1 re-verification ran — full report in
  [`docs/archive/2026-07-24-isometric-gap-check-v1-1.md`](2026-07-24-isometric-gap-check-v1-1.md)
  (328 atoms, 151 confirmed findings: 9 P0 / 78 P1 / 64 advisory; the P0s all
  map to already-tracked open P0-checklist items). Its adversarial pass
  corrected this entry's own first draft: **WBC contaminant thresholds bind
  under agricultural-soils v1.1** — do not treat requirements as v1.2-only
  without checking the report. `requirements-shortlist.md` and
  `schema-mapping.md` still derive from the v1.2 extraction; their refresh plus
  finding remediation is tracked under
  `isometric/v1-1-shortlist-reverification` in `docs/open-questions.md`.
- **Durability tier (closes `isometric/project-durability-tier`).** The
  operator changed the Certify project's "Durability of biochar" setting from
  200 years to **1000 years** in the Certify UI on 2026-07-24, matching the
  active template and the noma pipeline's 1000-year sequestration blueprint
  (`src/fn/certification/submit-removal.ts:submitRemoval` continues to validate
  local template-to-facility-tier agreement; the API still exposes no project
  durability field for an automated preflight).

Existing demo databases require a reset/reseed (or an operator mapping update)
to store protocol version 1.1: `src/db/seed-data.ts` deliberately skips the
whole seed when its facility already exists, so this change does not backfill
an existing mapping.

## 2026-07-24 (GHG Statement registry reconciliation)

The GHG Statements workspace now discovers and reconciles every paginated
registry statement for the linked project, including statements whose registry
period is absent or duplicates another statement's end date. Local surrogate
dates preserve the existing non-null period schema while metadata retains the
authoritative registry period.

Registry identity is the external statement ID, enforced by a partial unique
database index so simultaneous page-load and manual syncs converge on one local
statement. A period-less registry draft remains visible after sync but is not
adopted for an arbitrary operator-selected reporting date.

## 2026-07-24 (Certify project version audit + Source preview closeout)

### Certify project protocol observation

The Certify General page for project `prj_1K9YJ33RKSBX9FFF` showed baseline and
current **Biochar Production and Storage v1.1** and **Isometric Standard v1.7**.
The API does not expose a usable project protocol version: `GET /projects` has
no protocol fields, and `GET /ghg_statements/{id}` returned
`protocol_version: null`. `versions.json` therefore keeps the non-authoritative
interpretation target at v1.2 and now records the UI-observed v1.1/v1.7 project
state as a discrepancy, not a repin.

`submitRemoval` now compares `certifier_projects.protocol_version` with the
v1.2 interpretation pin. A match is silent. A mismatch or missing value emits
an IDs-only structured warning and appends a non-blocking
`removal:protocol-version-check` sync event so the stored column participates
in every submit-time audit. Submission continues.

Historical v1.3 labels in the 2026-07-03 fuel-accounting and reporting-window
entries below do not describe this project's configured protocol/module set.
The applicable local interpretation pins are Biochar Protocol v1.2 and Energy
Use Accounting v1.2; the project itself is observed on Biochar Protocol v1.1.
The implementation decisions remain in force, but their version applicability
must be confirmed when the operator resolves the project-version discrepancy.

### Source preview verdict

The Source mirror is byte-faithful: the registry copy of the generated ledger
matched noma's recorded SHA-256 and is a valid, correctly rendered PDF in
Quartz and Chrome. Certify's previewer rendered `@react-pdf/renderer` output
blank with subset TTF fonts and solid black with base-14 fonts, while a
browser-print PDF previewed normally. This isolates the failure to Isometric's
previewer; no PDF-generation change is warranted. The defect was reported to
Isometric through MCP feedback on 2026-07-24.

One-click diagnostic Sources for a future retest:

- `src_1KY9MZ6Y9SBXBGKW` — blank preview.
- `src_1KY9T9WVHSBXSHQP` — solid-black preview.
- `src_1KX9B828ESBX3N89` — browser-print PDF renders correctly.

## 2026-07-24 (`s_fraction` direct-datapoint correction)

A real sandbox submission established that the live
`biochar_sequestration_1000_year` template declares `s_fraction` with quantity
kind `dimensionless`. The measurement-sample property catalogue cannot express
that kind: its fraction-like properties, including
`dimensionless_ratio/inertinite_fraction`, all create
`dimensionless_ratio` datapoints. The registry therefore rejected binding the
measurement-sample datapoint to the `dimensionless` template input.

The 1000-year binding table now declares a source per input:

- `carbon_contents`: `measurement-property`
  (`mass_fraction_dry_basis/total_carbon`)
- `product_mass`: `measurement-property` (`mass`)
- `s_fraction`: `direct-datapoint` (`dimensionless`, unit `dimensionless`)

The orchestrator posts one direct `s_fraction` datapoint for every sampled
replicate through the existing versioned datapoint create/reconcile path and
binds those returned IDs as the GHG-entry LIST input. The same 0–1 values remain
in the measurement sample under
`dimensionless_ratio/inertinite_fraction` as data-quality evidence; only their
GHG-entry binding source changed. The source-aware table remains part of
`MAPPING_REVISION`, so this correction changes the semantic payload hash and
supersedes payloads built with the rejected binding.

## 2026-07-24 (explicit 1000-year sequestration datapoint binding)

1000-year measurement samples no longer rely on a nonexistent registry
auto-link. The submission path captures every required
`POST /measurement_samples` response `values[].datapoint_id`, groups them by
measurement property, maps them onto the live template component by
`blueprint_key` + `input_key`, and includes the sequestration component in the
GHG-entry body:

- `mass_fraction_dry_basis/total_carbon` → `carbon_contents` LIST
- `dimensionless_ratio/inertinite_fraction` → `s_fraction` LIST
- `mass/(no qualifier)` → `product_mass` SCALAR

The binding is keyed on `biochar_sequestration_1000_year`, never its current RTC
ID. Unknown sequestration blueprints, unknown inputs, absent response datapoints,
and multiple product-mass datapoints for the scalar input fail with actionable
errors instead of silently producing an emissions-only entry. The exact
1000-year key is allowed to bypass only the catalog-presence check because the
live template exposes the component while the blueprint catalog omits that exact
key; its input shapes live in the verified explicit binding table.

`MAPPING_REVISION` now fingerprints both the ordinary input mapping and the
sequestration binding table, and the revision is part of the semantic payload
hash so the new body supersedes older emissions-only submissions. When
`DURABILITY_MEASUREMENT_SAMPLES_LIVE` is off, submission remains blocked before
any registry write; no sequestration component is silently omitted.

`production_batch_id` remains null: the removal orchestrator has no local →
Isometric production-batch ID mapping or production-batch create/reconcile step.
Adding an unverified ID would reduce traceability rather than improve it; the
versioned supplier reference continues to anchor each measurement sample.

## 2026-07-23 (legacy sequestration blueprint compatibility)

Facility readiness accepts the explicitly bound 1000-year sequestration
blueprint when it remains embedded in an existing Isometric Removal Template
after Isometric retires it from the global component-blueprint catalogue. The
template is still the active contract for that component, and noma supplies its
inputs through the verified explicit binding table.

Unknown missing blueprint keys continue to fail closed. This compatibility path
does not alias a retired blueprint to a replacement with a different input
contract, and it does not modify the remote Isometric template.

## 2026-07-23 (GHG Statement creation dialog)

The period-first GHG Statement creation flow now uses the shared centered
`Modal` instead of a right-side drawer. The three-step behavior, validation,
membership preview, production confirmation, and Isometric payload are
unchanged.

Creation and list copy is shorter. The period summary now labels `Start` and
`End` separately: operators still choose only the inclusive end accepted by
Isometric, while the start remains read-only (`Set by Isometric` for the first
statement, then derived from the prior statement end).
