# Open Questions

Living tracker of design questions, deferred work, and items waiting on
external confirmation. Add freely; resolve by removing the entry and
recording the decision in the relevant feature doc (e.g.
`docs/isometric/changes.md` or `docs/architecture.md`).

Each entry follows this shape:

- **Title** (`area/topic` or `phase`) — owner, opened YYYY-MM-DD
  - Question / decision needed
  - Why it matters / blocking what
  - What we'd need to resolve it (sandbox check, stakeholder ask, doc lookup)

## Schema

### Dropped protocol-stub tables — re-add when each feature is built (opened 2026-06-08)

Removed in migration `drizzle/0037_sour_lethal_legion.sql`. These tables were
scaffolded ahead of implementation — defined in the schema but never queried or
seeded by any app code. Dropped to keep the schema honest about what the app
actually uses (no prod data yet, so re-adding later is cheap). Recover the
original column definitions from git history (the schema files just before
`0037`) when rebuilding the matching feature.

- **`loss_records`** (was `db/schema/loss.ts`) — Biochar Protocol §8.4.2 loss
  accounting (residue / spillage / runoff / volatilization / transport_loss
  adjusting batch CO₂e). Re-add when mass-loss accounting enters credit math.
- **`reversal_risk_assessments`** (was in `credits.ts`) — Appendix I reversal
  risk → buffer-pool %. Also dropped the `credit_batches.reversal_risk_assessment_id`
  FK and the `land_tenure_type` / `soil_erosion_risk` / `climate_volatility_risk`
  / `natural_disaster_risk` / `operator_track_record` enums. Today
  `credit_batches.buffer_pool_percent` is entered directly; re-add when
  buffer-pool justification is built.
- **`ghg_materiality_assessments`** (was in `compliance.ts`) — SSR-emissions-vs-
  net-removals materiality (<1%) checks per credit batch. Re-add when materiality
  assessment is implemented.
- **`feedstock_sc_assessments`** (was in `compliance.ts`) — per-feedstock
  sustainability-criteria pass/fail/conditional records with evidence docs.
  Re-add when the SC assessment workflow is built.
- **`custody_handoffs`** (was in `compliance.ts`) — chain-of-custody ledger.
  Redundant with the *built* chain-of-custody, which derives lineage from FK
  relationships (`data-access/chain-of-custody.ts`), not a ledger. Re-add only
  if an explicit handoff ledger is actually needed.
- **`certifier_sources`** (was in `certification.ts`) — Isometric Source
  definitions; `certification_submissions.source_id` FK dropped with it. Re-add
  when submission Sources are tracked locally rather than derived at submit time.
- **`emission_factors`** (was `db/schema/emissions.ts`) — region/fuel EF
  configuration. The app lets the Isometric component hold EFs (see
  [[transport-legs-distance-based]]); re-add only if EFs move in-house.
- **`production_runs.emission_factors_used`** (column) — JSONB snapshot of EFs
  applied to a run; selected in queries but never written. Re-add as an audit
  snapshot when run-level EF provenance is needed.

Also removed the same day (not Isometric-related): the legacy Next.js-starter
`projects` / `project_members` / `items` template cluster — tables plus their
`[projectId]` route tree, data-access, fn, hooks, components, and `requireProjectMember`
guard. Pure starter-template residue; the app is facility-scoped.

### Lab-characterization chemistry in `samples` kept `real` in the numeric conversion (`schema/samples-chemistry-precision`, opened 2026-07-03)

- **Decision (PR #342, issue #280):** the real→numeric conversion moved
  `h_to_c_org_ratio` and the heavy-metal/contaminant panel to exact `numeric`,
  but `total_carbon_percent` / `inorganic_carbon_percent` /
  `organic_carbon_percent` / `random_reflectance_r0_percent` intentionally stay
  `real` (`src/db/schema/production.ts`) — even though `organic_carbon_percent`
  feeds CO₂e-stored math directly. Rationale: float4 relative error (~1e-7) is
  far below lab assay precision, so no credit-bearing digit is at risk.
- **To resolve:** revisit whether issue #280's registry-reproducibility
  rationale (round-trip exactly what the operator entered) extends to these
  lab-characterization columns too; if yes, migrate them to the `percent`
  family in `src/db/schema/numeric-families.ts`.
- **Related note:** the `ppm` family caps at 999,999.9999 — marginally below
  the 1,000,000 ppm physical maximum of a pure substance. Irrelevant for
  hand-entered assay values; matters only if a lab/CSV import path ever writes
  gas-composition or contaminant ppm columns (none exists today).

## Architecture

### Auto-fill sample chemistry from an uploaded lab report (`samples/coa-autofill`, opened 2026-07-02)

- **Deferred from issue #309** (samples re-anchored on credit batches — built).
  The issue also asked: "it would be very nice if the user can upload the lab
  results and all the entries are automatically updated" — i.e. parse an
  uploaded COA/lab-report PDF and pre-fill the sample form's chemistry fields.
- **Why it matters:** the sample form has ~30 numeric fields transcribed by
  hand from the lab certificate; transcription errors feed directly into
  certified carbon figures.
- **To resolve:** decide extraction approach (LLM extraction vs. per-lab
  templates), confidence/review UX (never silently overwrite operator entries),
  and where parsing runs (server action + storage provider). The upload slot
  already exists (`lab_report` document on the sample's Evidence step).

### Validate production-run window ⊆ credit-batch period (`production/run-window`, opened 2026-07-01)

- **Deferred from the readings-CSV work (issue #207).** A production run may
  span multiple days, but its `start_time`/`end_time` window should not extend
  beyond the duration of its credit batch (the protocol production batch — see
  ADR 0016). No such cross-entity check exists today; runs are only loosely
  linked to batches, and `start_time`/`end_time` both default to `now()`.
- **Why it matters:** the readings importer already clips telemetry to the run
  window, so readings can't escape a run — but nothing stops a run's own window
  from exceeding its batch period, which would let telemetry land outside the
  batch it certifies.
- **To resolve:** decide where the run↔batch link is authoritative, then add
  the bound to the production-run create/update flow (`src/schemas/production-runs.ts`
  + `src/fn/production-runs.ts`). Touches the run form; keep it out of the CSV PR.

### White-label dashboards per Organization (`tenancy/white-label`, opened 2026-06-11)

- **Decision deferred (2026-06-11 multi-tenancy grilling):** at launch each
  Organization gets the org-scoped app with its name/logo in the chrome —
  no per-org subdomains, theming, or branded invitation emails.
- **To resolve:** revisit when a client asks for white-labeling; scope is
  wildcard domain routing, per-org theme tokens, branded Resend templates.

### Document access is authorized by UUID only — no entity/facility scoping (`security/document-authz`, opened 2026-06-15)

- **Current behavior:** `getDocumentById` / `updateDocument` / `setDocumentVisibility`
  and `assertCanManageDocumentEntity` (`src/data-access/documents.ts`) gate on
  `requireAuth(userId)` only. Any authenticated user who knows a document or
  owning-entity UUID can read a *private* document (including the
  `/api/documents/[id]` presigned-download redirect) or flip its visibility,
  without proving access to the owning `(entityType, entityId)`.
- **Why it's accepted for now (explicit decision, not a missed bug):** the app is
  single-tenant in practice — `requireProjectMember` is used in 0 data-access
  files; all 44 use `requireAuth`. Every account is admin-invited (no
  self-signup) and is a fully-trusted operator of the one org, so no boundary is
  crossed today. The only trust split is `admin` vs `user` (gates `/admin` + a
  few certification-settings actions) and it isn't applied to any domain entity,
  so documents are consistent with every other entity — not a regression.
- **When this becomes a real hole (fix before then):** the moment any
  *non-fully-trusted* account exists (external auditor, customer, limited
  reviewer) before per-facility/org scoping lands. The `visibility: public |
  private` column already encodes an intended boundary, so documents are the
  first surface to scope.
- **To resolve:** fold document reads/mutations through facility/entity-scoped
  authorization as part of the multi-tenancy work (ADR 0010,
  `docs/plans/2026-06-11-multi-tenancy.md`, [[multi-tenancy-plan]]). A
  `createdBy`-only stopgap is too tight — operators share documents on shared
  entities. Implement the `it.todo` negative tests in
  `tests/documents-authz.test.ts` against the scoped helper when scoping lands.

### Facility-wide monitoring dashboard / live map (`coc/facility-dashboard`, opened 2026-06-11)

- **Recorded as future, out of scope (2026-06-11 chain-of-custody-views
  grilling):** the Maji concept canvas also contains a one-screen
  monitoring dashboard (KPIs, geospatial panel, mini-Sankey, sensors,
  credit ledger), a facility-wide live map spanning all batches/routes,
  and an outward-facing public provenance showcase. The credit-batch
  anchor (`docs/plans/2026-06-11-chain-of-custody-views.md`, ADR 0011)
  deliberately covers only batch-scoped provenance.
- **To resolve:** revisit after Phase 3 ships — decide whether the
  existing dashboard route grows a geospatial/mass-balance panel, and
  whether a buyer-facing shareable page is wanted (different audience,
  different auth surface).

### Multi-hop biochar transport — intermediate storage before the customer (`transport/multi-hop-distribution`, opened 2026-06-11)

- **Current model:** a biochar product carries exactly ONE auto-derived
  distribution leg (facility → delivery destination), aggregated from its
  deliveries (mass-weighted distance, `transport_legs` one-derived-per-entity
  invariant). This matches Dark Earth Carbon's flow, where biochar ships from
  the facility straight to the application site. The manual "biochar → storage"
  leg editor was removed from the product sheet on 2026-06-11 (it predated
  derivation and invited rows the resync didn't own).
- **Question:** how to model organizations that truck biochar to an
  intermediate storage/depot first and onward to customers later — that's two
  (or more) real legs per product, with different masses per hop, which the
  single-derived-leg invariant can't represent. The live Isometric template's
  `biochar-transport` component ("Biochar transportation to storage site via
  truck", blueprint `transport`) takes one distance + mass pair per removal,
  so submission-side either needs per-hop Σ(dist×mass) folded into one
  equivalent leg, or a template change.
- **To resolve:** wait until an org with intermediate storage onboards; then
  decide between (a) multi-leg derivation with hop ordering on deliveries /
  storage transfers, folded into the equivalent single distance×mass for
  Certify, or (b) per-hop components in the removal template. Touches
  `aggregateDistributionLegs`, the one-derived-per-entity index, and the
  batch readiness transport gate.

### Additional storage locations — keeping the dMRV flexible (`transport/storage-topology`, opened 2026-06-11)

- **Question:** how does the dMRV stay correct when an org adds another
  storage location (second warehouse, off-site depot)? Parts of the flow
  hard-code a single facility-anchored storage topology today:
  - derived transport legs use the **facility** (name + GPS) as the biochar
    origin and the supplier/customer location as the other end — the storage
    location a product actually sits in never enters the route;
  - the live template's `biochar-transport` component assumes one
    facility → destination hop (see
    [multi-hop entry](#multi-hop-biochar-transport--intermediate-storage-before-the-customer-transportmulti-hop-distribution-opened-2026-06-11));
  - `biochar-storage` emissions (template group currently empty) would need
    per-location attribution if storage sites with different energy/fuel
    profiles appear.
- **Why it matters:** a second storage site silently changes real transport
  distances and storage emissions without changing anything the derivation
  reads, so submitted numbers drift from reality.
- **To resolve:** when a second storage site is on the roadmap, decide whether
  storage locations get GPS + distance provenance of their own and enter the
  leg derivation (origin = product's bin location instead of the facility),
  and whether storage-site transfers become first-class custody events in the
  chain-of-custody trail.

### Split `src/db/seed-data.ts` into domain seed modules (`db/seed-modularization`, opened 2026-06-11)

- **Problem:** `seed-data.ts` is ~1,390 lines, past the project's 1,000-line
  cap, and keeps growing as each new domain (latest: transport legs) appends
  its block to the single transaction.
- **To resolve:** extract per-domain modules (e.g. `src/db/seeds/transport.ts`
  exporting `createTransportLegsSeed(tx, ids)`) and leave `seed-data.ts` as a
  thin orchestrator. Mechanical but touchy — the blocks share the `ids` map —
  so do it as a dedicated refactor PR, not a drive-by (M).

### Postgres RLS as defense-in-depth (`tenancy/rls`, opened 2026-06-11)

- **Deferred, not rejected** (ADR 0010): the `organizationId`-on-every-table
  schema is RLS-ready with zero schema change. Add RLS policies +
  per-transaction `SET LOCAL` if a client contractually requires hard
  isolation guarantees beyond data-access-layer enforcement.

## Isometric Certify integration

### Template component → dmrv source mapping is hardcoded by display name (`certification/template-component-source-wizard`, opened 2026-07-04)

- **Decision needed** — where should the "this template component carries this
  dmrv aggregated source" mapping live? Today it's a code constant
  (`PYROLYSIS_DIESEL_SOURCE_BY_COMPONENT` in `transformers/datapoint.ts`), keyed
  by the component **display name**, because Certify's template model exposes no
  stable per-component key. It only bites when one `(group, blueprint, input)`
  triple is declared by more than one component — currently just the pyrolysis
  generator/startup diesel split (2026-07-04 changes.md entry).
- **Why it matters** — a display-name rename in the Isometric UI silently
  requires a code change (it fails closed with a clear SafeError, so it can't
  mis-submit — but it blocks the submit until code catches up). This couples the
  registry template to a code deploy, which a non-engineer operator can't do.
- **What we'd need to resolve it** — a facility-configurable component→source
  mapping (persisted on the certifier mapping row) plus a small assignment
  wizard in facility settings (pick each unmapped monitored component → dmrv
  source). The code constant becomes the seed/default. Scope it when a second
  multi-component triple appears, or when an operator needs to re-author the
  template without an engineer.

### Eq.6 R₀-term semantics — 1000-year F_durable normalization (`certification/fdurable-1000-r0-semantics`, opened 2026-07-03)

- **From issue #142** (1000-year CO₂e-stored preview path, built). The storage
  module ("Biochar Storage in Soil Environments" v1.2, Eq.6 §5.1.1.3.2) is
  internally inconsistent about the units/semantics of the first Eq.6 factor:
  - The **formal glossary** defines R̄₀ as the "mean of all R₀ measurements"
    and Table 3 lists both R₀ and C_non-reactive in **percent** — but the
    literal product of two percent-magnitude terms is dimensionally incoherent
    with the 0.95 cap (percent-as-number always saturates the cap at ~165;
    both-as-fractions yields an absurd ~0.0165).
  - The **narrative** ("credited for the percentage of their biochar which
    passes the 2% R₀ benchmark") instead implies the first multiplicand is the
    histogram **fraction of R₀ measurements ≥ 2%** (a 0–1 value), contradicting
    the glossary's mean-reflectance reading.
- **Local choice (preview only):** `computeFDurable1000`
  (`src/lib/calculations/biochar-removal.ts`) applies Eq.6 literally to the
  stored batch columns — R₀ term as mean-minus-std-dev in percent, carbon term
  normalized percent → fraction (÷100) so the 0.95 cap is meaningful — with the
  mandatory `min(0.95, max(0, …))` bounds guaranteeing output ∈ [0, 0.95] under
  any reading. The interpretation is documented loudly at the function.
- **Why it matters:** the local figure is a preview (the registry computes the
  authoritative F_durable at submission), but a wrong interpretation would show
  operators a misleading crediting estimate. **Needs Isometric confirmation
  before any LIVE 1000-year submission is driven off this preview.**
- **To resolve:** ask Isometric which reading is intended (mean R₀ vs. the
  ≥ 2% histogram fraction, and the exact unit treatment), then align
  `computeFDurable1000` + its tests and record the decision in
  `docs/isometric/changes.md`. Authoritative module:
  <https://registry.isometric.com/module/biochar-storage-soil-environments/1.2?tag=1.2.0>
- **Update (2026-07-04, research + ADR 0021).** The **live Certify blueprint**
  `biochar_sequestration_1000_year` resolves the ambiguity in favour of the
  **narrative reading**: its `s_fraction` LIST input is the per-replicate
  **proportion of R₀ readings ≥ 2%** (0–1), and the registry computes
  `product_mass × mean(carbon_contents) × durable_fraction × 3.667` with
  `durable_fraction = mean(s_fraction) − √(mean·(1−mean)/n)` (binomial SE). The
  blueprint has **NO non-reactive-carbon factor and NO 0.95 cap** — so it
  **diverges from module Eq.6** (which has both, and uses std-dev not binomial
  SE). **The blueprint is what runs**, so the live 1000-year path is built to it,
  not Eq.6 (`build1000YearSequestrationSample`); `computeFDurable1000` (Eq.6) stays
  the local **preview**. **Still needs Isometric staff sign-off:** which of Eq.6
  vs. the blueprint governs verification credit, and total-vs-organic carbon for
  `carbon_contents`. This question stays open until that sign-off.

### Credit-batch lab-sampling — Method-B Track 2 unlock followups (`certification/method-b-unlock-track-2`)

- **ADR 0017 Track 2 shipped** (PR #301): explicit Method-B unlock
  (`unlockMethodBForProcess`) with prerequisite capture, the μ−σ/√n unsampled
  estimate preview (`previewUnsampledCarbon`, 6-month eligible pool), the
  compliance-drift counters, `_unsampled` submission routing, the process-grain
  **DB trigger backstop** (migration `0060`) that replaces the dropped `0052`
  reactor trigger and counts only the pre-unlock baseline, and the operator surface
  moved under the registry-gated `/certification/production-processes`.
- **Still gated:** the live `_unsampled` submission POST stays behind
  `DURABILITY_MEASUREMENT_SAMPLES_LIVE = false` (wire format unconfirmed); the
  preview does NOT winsorise (the registry's 3σ winsorisation over the eligible
  pool remains the registry's authority, ADR 0013 / D1).
- **Gate shape to settle before activation:** Method-B cadence is a
  production-process history rule, not just the removal member-batch subset. The
  live submission gate should either load the full process batch window or accept
  an explicit process-level cadence fact.
- **Why it matters:** DEC runs Method A everywhere today, so Track 2 does not
  block current operation; do not enable Method B until the activation path and
  submission gate are process-grain end to end.
- **Watch:** entangled with ADR 0013 (submission measurement-samples) and issue
  #291 (template-driven remodel) — coordinate so the submission layer isn't
  double-built.
- **ADR-number hygiene (2026-06-20):** ADR 0017 (Method-B unlock) refines ADR
  0016; keep sampling/credit-batch references on ADR 0016 unless they specifically
  describe the Method-B unlock decision.

### Method-B compute — tracked cleanups on the process-grain surface (`certification/method-b-compute-cleanups`, opened 2026-06-20)

Low-priority consolidations on the Track 2 surface (PR #301 review), deferred so
they don't churn a freshly-introduced surface mid-review:

- **`sampleMeanStdDev` ⇄ `meanAndStdDev` convergence.** `lib/calculations/stats.ts`
  (`sampleMeanStdDev`) is a knowing near-duplicate of the private `meanAndStdDev`
  in `lib/isometric/utils/durability-aggregation.ts`. The aggregation copy can
  collapse onto the client-safe `stats.ts` helper once its server-coupled
  neighbour (`./aggregation`) is untangled from the client-safe path. Tracked here
  rather than only in the `stats.ts` file header.
- **O(n²) leave-one-out in `countSubThreeSigmaMeasurements`.** It recomputes
  `sampleMeanStdDev` over a fresh `filter` array per element. Fine for a 6-month
  window pool; if pools grow, the leave-one-out mean/variance can be computed
  analytically in O(n) from running sums. Low priority.

### Evidence-ledger font tracing — verify on first deploy (`isometric/evidence-ledger-font-tracing`, opened 2026-06-19)

- The evidence-ledger PDFs (the transport mass·distance ledger and, since Phase 4,
  the 200-year durability ledger — both auto-generated + mirrored as Sources on
  every Removal submit) render with bundled DM Sans/Mono TTFs read at runtime
  via a dynamic `process.cwd()` path (`src/lib/certification/evidence-ledger/
  fonts.ts`, shared by both renderers via `registerEvidenceLedgerFonts`). Next's
  static tracer can't follow a dynamic fs path, so the TTFs are pulled into the
  serverless bundle by `outputFileTracingIncludes` in `next.config.ts` (broad
  `"/**"` key, since the submit action bundles under several routes). The glob is
  directory-wide (`evidence-ledger/fonts/*.ttf`), so it already covers the
  durability renderer — no config change for Phase 4.
- **Why it matters:** serverless file-tracing can't be exercised locally. If the
  glob misses, the renderer throws `ENOENT` at submit time — and because ledger
  generation is best-effort (try/catch in `submitRemoval`), the failure is
  SILENT: the submit succeeds but no ledger Source is attached. So a wrong trace
  config looks like "working" until someone notices removals have no ledger.
- **Local status (2026-06-19):** the dev-runtime render + full
  generate→store→mirror→`source_ids` flow is **verified in-process** against the
  seeded sandbox (TTFs load fine via `process.cwd()` under `next dev`; see
  `docs/isometric/changes.md`). That leaves the remaining risk *narrowed to the
  serverless file-tracing path specifically* — local dev does not bundle, so the
  `outputFileTracingIncludes` glob is still unexercised. Entry stays open.
- **Resolve via:** on the first staging deploy, run a real submit and confirm a
  `transport_evidence_ledger` document + Source is created (check the removal's
  sources / the structured log line `generated evidence ledger`). The durability
  ledger (`durability_evidence_ledger`) shares the same fonts + render path, so a
  passing transport render confirms both; for a durability removal also confirm
  its document exists. If absent, inspect the function bundle for the `.ttf`
  files and tighten the trace key to the actual submit route(s). Record the
  outcome in `docs/isometric/changes.md` and remove this entry (S).

### 200-year durability measurement-samples — two sandbox confirms before live wiring (`isometric/durability-measurement-samples`, opened 2026-06-18)

- **Status (2026-06-20): Tier-1 Phases 1–5 built + committed** on
  `feat/tier1-durability-live-wiring` — the run → credit-batch re-grain, the facility
  reference soil-temp field, the staged measurement-samples submission step, the
  durability evidence-ledger PDF, and the two UX surfaces (lab-sample batch progress +
  credit-batch durability panel). See `docs/isometric/changes.md` → 2026-06-20. **The
  only thing still gating the live POST is the two sandbox-empirical confirms below**
  (datapoint↔input binding + the H/C unit scale); every decision is built and staged.
  **Do not remove this entry until `DURABILITY_MEASUREMENT_SAMPLES_LIVE` is flipped on
  after the operator runs the confirms** — at the same cutover, delete the stale
  `carbon_rich_substance_sequestration` `INPUT_MAPPING` entry (see the Phase 3 note).

- **1000-year extension (2026-07-04, verified in sandbox 2026-07-10, ADR 0021).** The durability tier is now
  facility-scoped; DEC (Moshi) is 1000-year. The recognition + guard plumbing for
  the **1000-year** submission path is built and has passed an end-to-end
  sandbox removal submit (still behind the sandbox-only
  `DURABILITY_MEASUREMENT_SAMPLES_LIVE` flag):
  - `biochar_sequestration_1000_year` is in `SEQUESTRATION_BLUEPRINT_KEYS`;
    `resolveTemplateInputs` skips the whole sequestration **family**
    (`isSequestrationBlueprintFamily`), so a 1000-year template no longer throws
    the misleading "no INPUT_MAPPING entry" error — it reaches the staging gate.
  - `submitRemoval` now validates the template's sequestration blueprint against
    the facility tier (`expectedSequestrationBlueprintKeys`) and fails closed early
    on a mismatch (200-year facility with a 1000-year template, or vice versa).
  - `build1000YearSequestrationSample` builds and submits the blueprint inputs
    (per-replicate `carbon_contents` + `s_fraction` LISTS + `product_mass` SCALAR,
    NO local mean/−SE/cap — the registry reduces). The sandbox accepted the
    versioned measurement sample and created the removal.
  - **s_fraction data model:** stored per Sample as
    `samples.s_reflectance_fraction` (the ISO 7404-5 inertinite fraction —
    proportion of that sample's R₀ readings ≥ 2%). The form now captures it as a
    percentage and stores/submits 0–1. Sandbox validation accepted
    `dimensionless_ratio/inertinite_fraction`; `carbon_contents` was accepted as
    total carbon with `mass_fraction_dry_basis/total_carbon`.

- **Grill-with-docs resolution (2026-06-19).** The Tier-1 wiring plan was stress-tested
  against ADR 0013 / ADR 0016 and the authoritative protocol (biochar 1.2 §8.3.1; soil module
  1.2 §5.1.1.3.1 — both re-verified via the isometric MCP). Decisions locked; full phased plan
  + sandbox-parameterised wiring checklist in
  `docs/plans/2026-06-19-tier1-durability-live-wiring.md`:
  1. **Re-grain run → credit batch (root issue).** The durability gates, aggregation, Phase-E
     measurement-sample builders, and the COA candidate-document walk all read `run.samples`,
     but ADR 0016 re-pointed lab samples to `creditBatchId` (run link now nullable, and
     `getProductionRunsWithSamples` skips null-run samples). Lab chemistry is therefore invisible
     to the durability surfaces — they must be re-grained to the **credit batch** before the live
     POST.
  2. **Sample model:** enter a Sample against **one production run** (provenance); **account at
     the credit batch** (pool ≥3 → mean + std-dev). The ≥3 are **independent samples distributed
     across runs/days** (§8.3.1), not aliquots; hard-gate the count, **warn** if not distributed.
  3. **Submitted shape:** one **measurement-sample submission** per credit batch carrying the
     batch's **mean + std-dev** (raw ≥3 evidenced by the COA + durability ledger); registry means
     the per-batch list.
  4. **Soil temperature:** an operator-declared **facility-level reference value** (global DB, e.g.
     Lembrechts 2022; 7 °C floor), justified in the PDD; per-application temps become a future
     override. New facility certification field.
  5. **COA:** the `lab_report` on each Sample, via the **existing** document→Source mirror
     (re-grain the walk to gather by credit batch); D4 gate at batch grain.
  6. **INPUT_MAPPING:** the stale `carbon_rich_substance_sequestration` entry is **deleted**; the
     two `biochar_sequestration_200_year_*` components are carved out of the legacy datapoint loop
     into the new measurement-samples step. `_unsampled` (Method B) is an **inert** seam — no
     estimate math (future ADR ~0017).
  7. **Scope grew (accepted):** a **durability evidence-ledger PDF** (reuse
     `fn/certification/evidence-ledger.ts`; `frontend-design` skill for layout) reconciling raw
     replicates → submitted mean+std-dev + soil-temp reference; plus **two UX surfaces** (lab-sample
     create form with single-run ref + live credit-batch sample count; credit-batch sample
     list/aggregation view).
  **Still blocking the live POST:** only the two sandbox-empirical confirms below — every decision
  above is buildable/stageable now.

- **Phase 3 staged (2026-06-19, branch `feat/tier1-durability-live-wiring`).** The
  measurement-samples submission step is built + wired into `runRemovalSubmission`, gated behind
  `DURABILITY_MEASUREMENT_SAMPLES_LIVE` (default **false**) in
  `src/fn/certification/durability-measurement-samples.ts`. When the flag is off, `submitRemoval`
  hard-blocks any template that declares a `biochar_sequestration_200_year_*` component with a
  "staged, not yet live" `SafeError` (so the new template can't be submitted until the two confirms
  land); `resolveTemplateInputs` + `buildCreateGhgEntryRequest` skip those components.
  - **DEFERRED — delete at the end of the last phase (live-flip cutover):** decision #6 above said
    to delete the stale `carbon_rich_substance_sequestration` `INPUT_MAPPING` entry *now*. It is
    **load-bearing on the still-live old-template carbon path** — referenced by 5 tests
    (`isometric-submit-removal`, `registry-boundary-removal`, `period-input-tuples`,
    `isometric-transformers`, `isometric-sources`) and `certify-field-registry.ts` (two `tuple(…)`
    descriptors). Deleting it while the new path is gated off breaks working tests for zero
    functional gain (the new template literally can't be submitted yet). **Decision (2026-06-19, with
    the user): keep it until the live flip**, then delete the `INPUT_MAPPING` entry + the two
    field-registry tuples (`biocharOutputKg`→`product_mass`, `organicCarbonPercent`→`carbon_content`)
    + retarget the 5 tests to the new sequestration shape, as the final cleanup of this entry.

- **Phase E of the 200-year durability build is built offline but the LIVE
  submit path is gated on two sandbox-empirical confirms.** The measurement-
  sample bodies (`src/lib/isometric/transformers/measurement-sample.ts`), the
  HTTP wrappers (`src/lib/isometric/measurement-samples.ts`), and the per-batch
  durability aggregation (Phase D) are done and unit-tested; what remains needs
  the operator's `pnpm isometric:coverage-check -- --source=db` against the
  sandbox (interactive 1Password — an agent can't run it).
  1. **Datapoint↔component-input binding.** How a `biochar_sequestration_200_year_*`
     blueprint input references the measurement-sample datapoints — auto-link by
     measurement type/property vs. an explicit `datapoint_id` reference. Not
     modelled yet; resolves the shape of the live submit wiring.
  2. **H/C ×100 unit transform.** The blueprint declares `h_c_molar_ratios` in
     `%`, but samples store a dimensionless molar ratio (~0.5).
     `toHcMolarRatioPercent` applies ×100 as the most likely transform — confirm
     direction/scale against the sandbox before crediting.
- **Doc evidence gathered 2026-06-18 (isometric MCP — non-authoritative, does
  NOT close the gate):**
  - *Confirm #2 (H/C unit) now leans dimensionless, NOT %.* Two authoritative
    docs point the same way: the Certify measurement-samples reference lists the
    Biochar→Production batch **H:C** property as quantity kind
    `DIMENSIONLESS_RATIO` / qualifier `HYDROGEN_TO_ORGANIC_CARBON_RATIO`; and the
    `biochar-storage-soil-environments` 1.2 module §3 Table 2 evaluates the molar
    H/C_org ratio as a dimensionless *Ratio* (threshold < 0.5). This suggests the
    current ×100 `toHcMolarRatioPercent` transform is likely **wrong** and the raw
    ~0.5 ratio should be sent. STILL verify against the live template's blueprint
    *input* unit declaration (rvt_1KS4S43VPSBXA26X) before flipping — the module
    doc covers the science, not the platform input declaration.
  - *Confirm #1 (binding) leans explicit reference, not auto-link.* The protocol
    docs don't define the platform binding; `user-guides/certify/datapoint-sharing`
    says a datapoint is created and then "used as an input to multiple components"
    (an explicit sharing act), so a component input most likely carries an explicit
    datapoint reference rather than auto-linking by measurement type/property. The
    type+property (quantity kind + qualifier) identify *what* a datapoint measures
    but don't by themselves bind it to a blueprint input. Confirm the exact field
    against the `post-datapoint` / component API schema (`certify.d.ts`) or the
    live sandbox.
  - Neither finding closes the gate — the binding field and the blueprint input
    unit are still sandbox-empirical. Run the coverage-check before live wiring.
- Also gated to the live wiring: the `total_carbon_contents` /
  `inorganic_carbon_contents` / `product_mass` datapoint construction + binding,
  the COA/lab-report Source behind the chemistry datapoints (D4), and recording
  the conservative soil-temp method string on the `biochar_soil` datapoint
  (the `CreateMeasurementSampleRequest` body has no description field).
- **Snapshot-back the measurement-sample bodies before the flip (resume
  coherence).** Today the gated step in `runRemovalSubmission` rebuilds the
  measurement-sample submissions from live `durability.batches` every attempt,
  whereas `transport.datapointBodies` and the fixed bindings come off the claimed
  row snapshot on resume. While the flag is off this is inert, but once live a
  resumed claim could reconcile a stale body (partial prior create) or POST
  changed live chemistry under the prior version (failed before create). Persist
  the built measurement-sample submissions into the payload snapshot and read
  them back on resume — same pattern as `transport.datapointBodies` — so the
  whole registry attempt stays version-coherent. (Surfaced in PR #297 review.)
- **Why it matters / blocking what:** the legacy
  `carbon_rich_substance_sequestration` `INPUT_MAPPING` entry references a
  blueprint the operator deleted when re-authoring the template, so live submit
  is already fail-closed (expected mid-migration; not-live, no prod data). The
  durability submission can't complete until the binding + transform are
  confirmed and the live wiring lands.
- Resolve via: run the coverage-check, confirm (1) + (2), wire the live path in
  `submit-removal.ts` (blueprint selection via `selectSequestrationBlueprintKey`,
  D6), replace the stale `INPUT_MAPPING` entry, then close this entry and record
  the decision in `docs/isometric/changes.md`. Plan:
  `docs/archive/plans/2026-06-18-200yr-durability-submission-and-sampling-method-enforcement.md`
  (§6 Phase E), ADR 0013.

### Ambiguous-lookup rejection records no failed sync event (`isometric/ambiguous-lookup-audit-silence`, opened 2026-06-10)

- **When a registry create's reconcile lookup finds MULTIPLE candidates**
  (today only reachable for GHG Statements — several DRAFT statements for one
  `(project, end_on)`), `performRegistryCreate`
  (`src/fn/certification/registry-create.ts`) rejects the ledger row and
  throws the caller's ambiguity message **without writing a failed sync
  event**. Deliberate Phase 2 parity with the pre-module GHG behavior; the
  reliability-track plan limited behavior changes to its two named ones.
- Not blind: the rejection reason survives in the ledger row's
  `metadata.lastError`, and the row status flips to `rejected`. But the
  statement's `certifier_sync_events` timeline just stops — the detail panel's
  "recent sync events" list shows nothing for the failed attempt.
- Phase 3's boundary test pins the current behavior by assertion
  (`tests/registry-boundary-ghg-statement.test.ts`, "rejects with the
  ambiguity message…") with a pointer here — flip that assertion when this is
  resolved.
- Resolve via: decide whether ambiguity should append a `status: "failed"`
  sync event (operation `ghg_statement:create`, errorMessage = the ambiguity
  wording, no response body) for audit-timeline completeness. One-line change
  in `reconcileToResult` + the pinned assertion; no migration.

### GHG Entry API rename — September 2026 sunset cleanup (`isometric/ghg-entry-migration`, opened 2026-06-10)

- **Migration landed 2026-06-10** (plan Phases 1–4; see
  [`docs/isometric/changes.md`](./isometric/changes.md) → 2026-06-10). noma now
  calls the `ghg_entry` route family; the regen pipeline points at the
  docs-hosted Certify spec.
- **What remains, post-sunset (after September 2026):** Isometric removes the
  deprecated `removal*` endpoints/fields. At that point: (a) regenerate
  `certify.d.ts` — the deprecated `Removal*` schemas + `GhgStatement.removal_ids`
  / `Component.removal_template_component_id` keys disappear, so the test mocks
  that still carry both old+new fields (`isometric-reconciliation.test.ts`,
  `isometric-ghg-statement-flow.test.ts`,
  `isometric-ghg-statement-submit.test.ts`) drop the deprecated keys; (b) delete the
  🚫-marked deprecated rows from `docs/isometric/openapi-index.md`. No app-code
  change expected — the wire layer already only calls the new routes.
- **Sunset date CONFIRMED ~September 2026** (issue #353, 2026-07-04) — previously
  an unverified assumption from #291. Post-sunset cleanup above is unchanged.
- **Domain term "Removal" is RETAINED** (stakeholder decision, 2026-07-04): the
  `Removal → GhgEntry` *domain* rename floated in ADR 0014 is **decided against**.
  Only the wire/API layer uses `ghg_entry*` (already done); our routes, UI,
  tables, and `CONTEXT.md` keep "Removal" as the canonical submission-unit term.
  Verified 2026-07-04 that no deprecated `/removals` or `/removal_templates`
  endpoint calls remain (`submissions.test.ts` guards it).
- Full inventory + verified renames + phased plan:
  [`docs/plans/2026-06-10-isometric-ghg-entry-migration.md`](./plans/2026-06-10-isometric-ghg-entry-migration.md).

### GHG entry / statement free-field follow-ups from the rename (`isometric/ghg-entry-free-fields`, opened 2026-06-10)

The migrated surface returns fields noma does not yet capture. Each is a new
capability, not a blocker — tracked here so they are not lost:

- **Credit allocation / buffer pool.** `GhgEntry` + `GhgStatement` now expose
  `risk_of_reversal_percentage` and `credit_allocation`
  (`buffer_pool_contribution_kg` / `supplier_allocation_kg`). Surfacing the
  split on the certify panel / credit-batch detail is new UI. Relates to the
  dropped `reversal_risk_assessments` table (see Schema section above).
- **Reporting-period readback.** `GhgStatement.reporting_period_start_at` /
  `_end_at` are returned; reading them back can fix the known reconciliation
  gap where the statement wizard's "predicted to be linked" preview
  over-promises against Isometric's server-derived period.
- **Source `description`.** Optional human-readable label now accepted on
  `POST /sources` / `PATCH /sources/{id}` (we pass the `Undefined` sentinel
  today). Wire it to a real label when the Sources panel grows one.

### Certification submit surface is authenticated but not facility-scoped — IDOR (`security/certification-submit-authz`, opened 2026-06-18)

- **Status:** a resolved-facility scope **seam** shipped (issue #277) —
  `resolveSubmissionFacilityId` / `assertSubmissionInFacility` in
  `data-access/certification.ts` resolve a submission's owning facility from its
  anchor row (never a client field) and the id/key-addressed reads take an
  optional `expectedFacilityId`. This is **defence-in-depth + fail-closed on a
  dangling anchor, not cross-facility (IDOR) authorization**: every wired caller
  derives the expected facility from the same anchor id it is reading, so the
  live comparison is lineage-consistency, not an access check. `submitRemovalAction`
  and `createRemovalWithBatchesAction` were **not** wired to the seam in that
  slice, and the three admin mapping/emission actions stay on the **global**
  `requireAdminAction()`. Dated shipped-detail log:
  [`docs/archive/2026-07-09-certification-submit-facility-scope-partial-fix.md`](./archive/2026-07-09-certification-submit-facility-scope-partial-fix.md).
  **Still open (needs #372/ADR 0010):** true per-*user* membership / an
  independent caller-facility to compare against, so a genuine cross-facility id
  swap is refused. Do not close #277's parent concern until the membership model
  lands.
- **Blocker before a second facility/org operator shares the deployment.**
  Formalizes pre-deploy gate #3 in
  [`integration-plan.md`](./isometric/integration-plan.md) and depends on the
  ADR 0010 Organizations model.
- **Finding (authz audit, 2026-06-18):** every GHG-entry / GHG-statement server
  action passes `withAction → getUser` (so there is **no anonymous surface** — 0
  critical) but then resolves its target by **client-supplied id with only
  `requireAuth`** underneath (a non-empty-string check in `data-access/utils.ts`,
  not an access check). Any authenticated user can drive irreversible Isometric
  writes against **any** facility's resources:
  - `submitRemovalAction` / `submitTelemetryAction` — any `removalId` (facility
    is server-derived from the row, but the row is fetched by id only).
  - `createGhgStatementDraft` — trusts the client `facilityId` end-to-end.
  - `submitGhgStatementToVerifier` / `refreshGhgStatementStatus` — any
    `ghgStatementId` / `submissionId` (highest-consequence: verifier submission).
  - `createRemovalWithBatchesAction` — blocks cross-facility *mixing* only.
  - the three admin mapping/emission actions call `requireAdminAction()`, but
    "admin" is **global**, so a per-org admin could reach another org.
- **Root cause:** there is **no membership model**. `src/lib/auth/server.ts`
  exposes only `getUser` / `requireAuth` / `requireAdminAction`; the
  `requireFacilityMember` / `requireProjectMember` helpers named in CLAUDE.md
  **do not exist in code**, and no `organizationId`/owner column exists on
  `facilities`, `certifierRemovals`, `certifierGhgStatements`, or `creditBatches`
  — there is nothing to scope to.
- **Exploitable today?** No — single operator, single tenant. **Live the instant
  a second facility/org operator exists** (cross-tenant data + registry-write
  breach, not a hardening nice-to-have).
- **Pattern to copy:** `mirrorDocumentToSource` / `unlinkDocumentSource` enforce
  a forgery-proof document→removal lineage anchor
  (`assertDocumentIsCandidateForRemoval`); `reconcileRemovalMembership` is
  facility-predicated + `FOR UPDATE` internally.
- **Resolve via:** land ADR 0010 (Organizations + `organizationId` on facilities
  + membership), build a real `requireFacilityMember(userId, facilityId)`
  (building it is itself the first task — do not wire a call to a missing
  helper), then gate **every** removal/statement/telemetry/mapping/emission
  accessor on the *resolved* facility (resolve the facility from the row, never a
  separate client field), and scope the three admin actions to that facility.
  Same authz class as `security/document-authz`; relates to `tenancy/rls` and the
  multi-tenancy plan. Full audit: `.tmp_pdf/isometric-ghg-integration-audit.html`.

### GHG-statement period-overlap: app-layer guard vs. DB constraint (`isometric/ghg-period-overlap-db-constraint`, opened 2026-06-04)

- **Non-overlapping reporting periods are enforced in `createGhgStatementDraft`**
  (reject an `end_on` ≤ the latest other statement's end) and mirrored in the
  create drawer. This is a read-then-write check, not a DB invariant.
- A truly concurrent pair of creates with overlapping periods could both pass
  the check (TOCTOU). Low likelihood — periods are consecutive, the
  `(provider, facility, end_on)` unique constraint already blocks exact dupes,
  and this is a single-operator internal tool — but it's not airtight.
- Resolve via: a Postgres `EXCLUDE USING gist` range constraint on
  `(facility_id, daterange(reporting_period_start_on, reporting_period_end_on))`
  once start dates are reliably populated (they're reconciled post-create, so a
  draft row has a null start until Isometric returns the window — the constraint
  would need to tolerate that or be deferred). Decide if the DB-level guarantee
  is worth the `btree_gist` extension + null-start handling.

### Transport-leg compliance follow-ups (opened 2026-05-13)

- **Per-leg evidence model deferred** (`isometric/transport-v1.1-evidence`) —
  opened 2026-05-13, deferred to follow-up PR.
  - Isometric Transportation v1.1 §6 + Appendix 1 require: emission-factor
    source citation, factor vintage by mode (road ≤3 y, ship/air ≤5 y,
    rail/pipeline ≤7 y), round-trip vs. onward-leg evidence, distance-method
    fallback justification (§3.1 "appropriately evidenced"), weigh-scale
    calibration record, vehicle class/model year.
  - Current state: `transport_legs.emissionFactorSource` exists but is
    optional; no schema columns for factor vintage, round-trip flag, onward
    destination, or fallback evidence. Form text mentions §3.2 but
    validators do not enforce.
  - Resolve via: a dedicated PR with a Drizzle migration adding the
    columns, condition-registry rules, refreshed
    `docs/isometric/schema-mapping.md` rows 30–32, and three new entries
    on `docs/isometric/p0-compliance-checklist.md`
    (P0-16 method-hierarchy + fallback evidence, P0-17 per-leg
    round-trip default, P0-18 factor vintage by mode).

- **Per-leg vs aggregated submission strategy** (`isometric/transport-v1.1-aggregation`) —
  opened 2026-05-13, **interim resolution shipped 2026-05-13**.
  - Original plan: flip `INPUT_MAPPING` transport rows from
    `distance` (km) to `co2e` (kg) and submit summed per-leg emissions.
    Blocked because Certify's `transport` blueprint exposes
    `distance` / `mass` / `carbon_intensity` as separate inputs with
    `quantity_kind = "distance"`; the strict guard in
    `src/lib/isometric/transformers/datapoint.ts:201-211` rejects unit
    mismatches.
  - **2026-06-19 update — resolved within the SCALAR constraint.** The
    operator re-authored the template onto the
    `mass_distance_based_ci_emissions` blueprint, so each category now submits
    one `mass_distance` (tonne·km) scalar = `Σⱼ(distⱼ × massⱼ)` directly (no
    avg-distance hack), still enforcing per-category factor uniformity. See
    `aggregateTransportMassDistance` in
    `src/lib/isometric/utils/aggregation.ts` and the 2026-06-19 entry in
    `docs/isometric/changes.md`.
  - **True per-leg submission is categorically impossible, not merely
    un-exposed.** A live catalog sweep (2026-06-19) confirmed *every*
    `mass_distance` input across all Certify blueprints is `data_shape: SCALAR`;
    no transport blueprint accepts a `datapoint_ids` LIST. Per-leg visibility
    would require one component *instance* per leg (dynamic
    `AddComponentToRemoval`, outside the template-driven pipeline) and yields no
    numerical gain for same-mode legs — rejected.
  - **Deferred — mixed-mode transport** (`isometric/transport-mixed-mode`): one
    `mass_distance` component carries one emission factor, so rail/ship legs
    (different EF) cannot be summed into a road tonne·km scalar — today they trip
    the mixed-factor warning and block submission. Supporting them needs
    per-mode component instances. Out of scope while the transport UI is
    road-only (`transport-legs-ui-pattern`); re-raise when a non-road mode is
    enterable.

- **No facility-membership model in codebase**
  (`auth/facility-scoping`) — opened 2026-05-13, parked.
  - The new `resolveEntityFacility` in
    `src/data-access/transport-legs.ts` walks the polymorphic parent
    chain back to a facility on every read/write, closing the
    orphan-mutation hole — but the codebase has no "user X may access
    facility Y" check anywhere (audited across `feedstocks`,
    `biochar-products`, `samples`, `deliveries`, `production-runs`).
  - Upgrade: when a facility-membership model lands, swap
    `resolveEntityFacility` for `requireFacilityAccess(userId, fac)` in
    `transport-legs.ts` (one chokepoint) and propagate the helper to
    the other data-access modules.
  - **2026-05-22 update (ADR 0003):** `src/data-access/certifier-removals.ts`
    joins this list — `getCertifierRemovalById`, `listRemovalsForFacility`,
    `getCreditBatchesByRemovalId`, `ensureRemovalForCreditBatch`,
    `assignCreditBatchToRemoval`, `updateRemovalDates` all guard with
    `requireAuth` only. The refactor widened the id-addressable surface
    (`submitRemovalAction` / `assignCreditBatchToRemovalAction` take a raw
    `removalId` from the client), so an authenticated user can submit or
    regroup any facility's removal by id — including driving an external
    Isometric POST. No regression vs. the deleted `submit-credit-batch.ts`
    (same posture), but **decision needed before a second facility operator
    is onboarded**: accept as single-tenant, or land the membership model
    and gate every removal accessor on the resolved facility.

- **Isometric MCP token-URL deprecated 2026-05-15** (`isometric/mcp-auth`) —
  opened 2026-05-13.
  - `https://api.isometric.com/mcp/?token=…` is removed 2026-05-15
    (2 days from 2026-05-13). Replacement: `https://api.isometric.com/mcp`
    with Certify/Registry account sign-in
    (https://docs.isometric.com/user-guides/ai/mcp-server). Dev-tooling
    only; no production code path affected.
  - Migration tracked separately; verify via
    `mcp__claude_ai_isometric__me` after switching.

> **Note:** ADR 0003 / ADR 0004 pre-deploy gates (legacy ledger cutover,
> destructive migration `0021`, wide id-addressable removal/GHG-statement
> surface, no-zero-stub-in-prod) live in
> `docs/isometric/integration-plan.md` → **Pre-deploy gates**. They are
> actions before deploy, not open questions.

### Remaining template-coverage gaps

The Phase 3 / 3.6 / 3.7 template inspection found ~10 input coverage gaps;
all are now closed (the period-level inputs were resolved 2026-05-24 by
[ADR 0005](../adr/0005-period-emissions-as-project-components.md) — they're
now `PROJECT`-scope Components managed in the Isometric UI). The full
breakdown is in `docs/isometric/changes.md` (2026-05-11, 2026-05-13,
2026-05-21 entries). Two forward-looking items remain:

- **Pyrolyzer pre/post electricity readout** (`isometric/phase-3-readouts`)
  — opened 2026-05-13. `INPUT_MAPPING` under
  `pyrolysis / metered_energy_based_ci_emissions` synthesises
  `initial_readout = 0`, `final_readout = totalElectricityKwh`. The
  difference equals real consumption, which is the only quantity Certify
  uses downstream — verifier-acceptable today, but replace with real
  per-run pre/post readouts when `production_runs` gains the columns.

- **`isometric/mapping-version-dimension`** — opened 2026-05-24,
  **deferred**.
  - **Question:** when Isometric introduces blueprint versioning (e.g.
    `pyrolysis@v1` → `pyrolysis@v2` where `carbon_content` moves from
    `dimensionless` to `mass_fraction`), how should `INPUT_MAPPING`
    represent the version dimension — a 4-tuple
    `(group, blueprint, blueprintVersion, input)`, an
    `N`-entries-per-input branch-on-`compatible_unit` model, or
    something else?
  - **Why deferred:** the Certify OpenAPI surface today does not expose
    any `blueprint_version` field — verified by grep across
    `src/lib/isometric/generated/certify.d.ts`. There are no concrete
    versioning examples to model the table against, so any 4-tuple
    decision would be speculative. Submit-time guards
    (`datapoint.ts:394-404`) + the nightly coverage check (B1) catch
    type/unit mismatches; no near-term integrity risk.
  - **Resolve via:** re-read the OpenAPI on any spec bump; reopen this
    entry the first time Isometric ships a versioned blueprint. The
    decision then has a concrete example to anchor against.

### Phase 5 Slice B / C deferrals (opened 2026-05-29)

Scoped out of the Phase 5 Slice A design (biochar reactor time-series via
Parquet — see [ADR 0006](./adr/0006-data-upload-submission-idempotency.md))
during the 2026-05-28 grilling session. Each is independently shippable
once Slice A is in production and operator demand surfaces.

- **Slice B — `POST /biochar_applications`** (`isometric/phase-5-slice-b`)
  - Per-spread-event JSON submission (`application_date`,
    `truck_mass_on_arrival/departure`, `average_application_rate`) that
    Isometric verifiers use to inspect individual delivery records.
  - Why deferred: requires two upstream primitives that noma does not
    currently post — `POST /production_batches` and
    `POST /projects/{id}/storage_locations`. Resolving the upstream
    dependency chain doubles the scope vs. Slice A.
  - Resolve via: a focused PR that wires the two upstream primitives,
    then layers `biochar_applications` on top. Likely opens around the
    same time soil-storage requirements push Isometric to add
    `storage_locations`-aware endpoints. Per-application
    `supplier_reference_id` IS supported by the create request
    (`certify.d.ts:1527`), so the standard reconciliation pattern
    applies — no ADR 0006-style departure needed.

- **Slice C — `MonitoringSubmission`** (`isometric/phase-5-slice-c`)
  - `POST /projects/{project_id}/monitoring_requirements/{id}/submissions`
    — structured-by-requirement submissions, parallel surface to the
    bulk Parquet path Slice A targets.
  - Why deferred: overlaps with Slice A's purpose for biochar reactor
    telemetry. Without operator demand we don't know whether
    `MonitoringSubmission` or `DataUploadSubmission` is the canonical
    home for which protocol-mandated measurements.
  - Resolve via: ask Isometric directly, "for biochar reactor
    temperature/pressure, do you prefer MonitoringSubmission or
    DataUploadSubmission?" If MonitoringSubmission, consider whether
    Slice A's hourly aggregator becomes a `MonitoringSubmission`
    feeder rather than a Parquet writer.

### Isometric Certify docs — UPPERCASE vs lowercase enum mismatch (opened 2026-05-29, filed 2026-05-29)

- **Status:** filed with Isometric via `mcp__isometric__submit_feedback`
  on 2026-05-29. Remains open here until the docs page is updated.
- The "Uploading time series data" docs page
  (`docs.isometric.com/user-guides/certify/time-series-data-upload`)
  shows measurement-property quantity_kind and qualifier values in
  UPPERCASE (`TEMPERATURE`, `PRESSURE`, `MASS_FRACTION`, `COMPOUND_CO2`).
  The actual API requires **lowercase** — confirmed against sandbox on
  2026-05-29 with `POST /sensors`:
  - UPPERCASE → 422 enum violation listing the canonical lowercase set.
  - lowercase (`temperature`, `pressure`, `mass_fraction`,
    `compound_co2`) → accepted.
- Why it matters: future readers (including us) following the docs to
  build a Parquet writer will produce rejected requests until they
  discover the case mismatch by trial.
- Resolve via: re-check the docs page in the next update-playbook
  pass; close this entry when the prose matches the live API.

### Isometric Certify docs — 60-second cap on aggregation-period is undocumented (opened 2026-05-29, filed 2026-05-29)

- **Status:** filed with Isometric via `mcp__isometric__submit_feedback`
  on 2026-05-29. Remains open here until the docs page is updated.
- The end-to-end sandbox smoke on 2026-05-29 (the parquet smoke probe,
  since deleted — its pattern lives in
  `tests/isometric-sandbox.integration.test.ts`) showed Isometric
  rejects DataUploadSubmissions where
  `aggregation_period_end - aggregation_period_start > 60 s` with
  `AggregationPeriodDurationInvalidError: Aggregation period of N
  seconds exceeds maximum allowed of 60 seconds`. The public docs page
  (`docs.isometric.com/user-guides/certify/time-series-data-upload`)
  describes the Parquet column shape but does not state this cap, so a
  reader following the docs alone will choose any window size and only
  discover the limit at submit time.
- Why it matters: noma's first integration design (2026-05-29 morning)
  picked 1-hour windows on verifier-readability grounds; the smoke
  forced a revision to 60-second windows after the docs gave no
  warning. Future integrations will hit the same wall.
- Resolve via: re-check the docs page in the next update-playbook
  pass; close this entry when the prose names the cap.

### Isometric Certify docs — biochar pyrolysis reactor declared DAC-only (opened 2026-05-29, filed 2026-05-29)

- **Status:** filed with Isometric via `mcp__isometric__submit_feedback`
  on 2026-05-29. Remains open here until the docs page is updated.
- The same docs page opens with: *"Time series data can currently be
  associated with either a Direct Air Capture (DAC) capture facility
  or a DAC storage location (saline aquifer),"* but then lists
  Biochar Pyrolysis Reactor measurement properties and the OpenAPI
  enum includes `biochar_pyrolysis_reactor_facility_time_series`.
  Sandbox probe on 2026-05-29 confirmed the API accepts the biochar
  submission_type; the prose intro is stale.
- Why it matters: anyone evaluating "does Isometric support biochar
  time-series?" via the docs prose will incorrectly conclude no.
- Resolve via: re-check the docs page in the next update-playbook
  pass; close this entry when the intro enumerates biochar alongside
  DAC.

### Isometric Certify API — no facilities LIST endpoint (forces paste-only `fcl_…`) (`isometric/facilities-list-endpoint`, opened 2026-06-10, filed 2026-06-10)

- **Status:** filed with Isometric via `mcp__isometric__submit_feedback`
  (missing capability) on 2026-06-10. Remains open here until a read endpoint
  exists.
- The Certify API exposes **no way to enumerate facilities** — verified against
  the live operation list (`mcp__isometric__openapi_documents_list_objects`,
  certify): no `GET /facilities`, no `GET /projects/{project_id}/facilities`,
  no `POST /facilities`. The facility id (`fcl_…`) appears only as a stored
  scalar field on other resources.
- **Why it matters:** the facility certifier mapping's "Isometric facility
  (telemetry)" field (`externalFacilityId`) is therefore a free-text paste —
  operators create the facility in the Certify UI, then hand-copy the `fcl_…`
  id into noma (`facility-certifier-dialog.tsx`). Error-prone (typo →
  telemetry submitted against the wrong facility), and it's the one mapping
  field with no validation against a real list. We wanted a dropdown; the
  missing LIST capability blocks it. (Creation being UI-only is fine and
  intentional — the gap is purely the missing read.)
- **Resolve via:** when Isometric ships a read endpoint (ideally
  `GET /projects/{project_id}/facilities` returning id + display name), wire the
  dropdown by mirroring the existing template-picker chain:
  `listFacilitiesByProject()` in `src/lib/isometric/projects.ts` → a
  `useIsometricProjectFacilities(projectId)` hook (pattern:
  `useIsometricProjectTemplates`) → swap the free-text `externalFacilityId`
  `FormInput` for a `FormSelect` in `facility-certifier-dialog.tsx`. Re-check
  the certify OpenAPI operation list on the next update-playbook pass; close
  this entry once the endpoint exists.

### Phase 4 deferrals

- **Isometric webhook contract availability** (`isometric/phase-5`) — opened 2026-05-06
  - When will Isometric publish a webhook event schema, signature
    header, and HMAC algorithm we can verify against?
  - Why it matters: blocks any automated reconciliation of GHG-statement
    state. `certifierProjects.webhookSecret` exists in the schema, but
    Certify's OpenAPI declares `webhooks = Record<string, never>` and
    no webhook topic exists at `https://docs.isometric.com`. Today
    users rely on the manual "Refresh" button calling
    `refreshGhgStatementStatus` to reconcile. A receiver built today
    would be guessing payload shape, signature header name, and HMAC
    algorithm.
  - Resolve via: ask Isometric support directly; check
    `api-reference/` quarterly via the existing update playbook
    (`docs/isometric/update-playbook.md`). Once the contract is
    published, build `src/app/api/certification/webhook/route.ts`
    and add HMAC + reconciliation tests.

- **External GHG statement amendment claiming** (`isometric/phase-5`) - opened 2026-05-05
  - Detect when an admin edits GHG statement dates or attached Removals
    directly in Isometric and the registry creates a new statement-version
    draft that noma has not claimed.
  - Why: Phase 4 surfaces `pending_total_co2e_removed_kg` and supports
    resubmission against the known local row, but it does not compare the
    local `externalId` against the registry's current period draft on every
    refresh.
  - Resolve by adding a claim/reconcile flow for external statement-version
    drafts.

- **Hash-changed partial-orphan cleanup** (`isometric/phase-5`) - opened 2026-05-05
  - Reconcile or report Datapoints/Removals created by a failed attempt when
    local inputs changed before the retry, causing a new payload hash and new
    supplier refs.
  - Why: same-hash retries now reuse stored refs and reconcile before POST,
    but changed-hash retries intentionally create a fresh version. Any remote
    resource from the failed old hash can remain orphaned.
  - Resolve only if production traffic shows this failure mode often enough
    to justify per-Datapoint sub-ledger bookkeeping.

- **Per-input source attribution** (`isometric/sources-per-input-attribution`)
  — opened 2026-05-26
  - Phase 3.5 ships removal-wide attribution: every monitored Datapoint
    receives the same `source_ids` list. Verifiers see complete evidence
    per Datapoint but lose the per-input narrowing that "this lab report
    supports carbon_content + product_mass, not transport distance"
    would convey.
  - Why: a verification-quality concern, not an API correctness one. The
    Isometric API accepts removal-wide source attribution today.
  - Resolve by: extending `loadCandidateDocumentsForRemovalAction` to
    return per-input bindings (or a per-blueprint heuristic) and threading
    them through `buildCreateDatapointRequest`'s `sourceIds` arg, which is
    already per-input. Defer until Phase 5 or operator feedback signals
    it's needed.

- **Stream large source files** (`isometric/sources-stream-large-files`)
  — opened 2026-05-26
  - Phase 3.5 caps mirror size at 50 MB via `arrayBuffer()` for code
    simplicity. Larger documents fail loud with a `SafeError`.
  - Resolve by: piping `response.body` (ReadableStream) from the noma
    storage download directly into the Isometric PUT body with
    `duplex: "half"`. Modern Node fetch supports this; needs careful
    `Content-Length` handling.
  - Defer until a real LCA PDF or video evidence exceeds the cap.

- **Mirror lock held across Isometric HTTP round-trips**
  (`isometric/sources-lock-hold-time`) — opened 2026-05-26
  - `mirrorDocumentToSource` holds the per-document mirror advisory lock
    across three Isometric calls (`findSourceBySupplierRef`,
    `createSource` / `requestSignedUploadUrl`, `putBlobToSignedUrl`) plus
    the storage download. Now that `submitRemoval` and
    `setDocumentSourceVisibility` also acquire the same lock, a slow
    upload of a `SOURCES_MAX_BYTES` blob (50 MB cap) stalls every
    concurrent submit + visibility flip on the same document for the
    full upload duration. Acceptable for single-tenant v1; logged as the
    main scalability tradeoff to revisit before multi-operator workloads.
  - Resolve by: split mirror into a `reserve` phase (lock, look-up
    remote, request upload URL, persist a `pending` mapping, release
    lock) and an `upload` phase (PUT without holding the lock,
    re-acquire briefly to flip `pending → ready`). Adds one
    `upload_status` column to `certifier_document_uploads` and one extra
    DB round-trip per mirror, but unblocks parallel work on neighbouring
    documents.

- **Per-input source attribution (was: removal-wide attribution)**
  see `isometric/sources-per-input-attribution` above — unchanged by the
  Phase 3.5 hardening; still removal-wide.

### Phase 3.5 source-mutation hardening — deferred simplifications (opened 2026-05-26)

Surfaced by the `/simplify` pass that followed the P1/P2 fix set (tx
threading, removalId scoping with `assertDocumentIsCandidateForRemoval`,
locked source-id resolution in submit, `isPublic` reconciliation). All
below the threshold for the same PR; revisit next time the area is
touched.

- **Extract `finalizeSnapshotInputs` from `submitRemoval`'s create-new-version
  closure** (`code/submit-removal-finalize-helper`)
  - The `prepare` callback passed to
    `insertDraftSubmissionWithMappingLockAndLocks` in
    `src/fn/certification/submit-removal.ts` is ~80 lines mixing lock
    acquisition, conditional source-id reconciliation, hash
    recomputation, template-input rebuild, and final
    `InsertDraftSubmissionInput` assembly. Readable today (linear,
    rare-path clearly marked) but a third caller would force extraction.
  - Resolve via: pull `finalizeSnapshotInputs({candidateDocumentIds,
    tentativeSourceIds, semanticPayload, semanticHash, monitored,
    datapointBodyByKey, …})` into a sibling module; the closure shrinks
    to "acquire locks → call helper → return input".

- **Extract `assertDocumentReadyForMirror` pre-flight from
  `mirrorDocumentToSource`** (`code/mirror-preflight-helper`)
  - 10 sequential `SafeError` throws on document nullability fields
    (`storageKey`, `fileSizeBytes`, `mimeType`, head size match, …) plus
    the post-validation `: number` / `: string` narrowing tricks.
    Pre-existing pattern, not introduced by the hardening, but the
    extraction would also delete the `!` non-null assertions in
    `buildSourceRequestBody`.
  - Resolve via: lift to a helper returning narrowed locals
    `{fileSizeBytes, mimeType}` so the function signature carries the
    invariant.

- **Export `DbClient = DbTransaction | typeof db` from `@/db`**
  (`code/dbclient-alias`)
  - `src/data-access/certifier-document-uploads.ts` defines the alias
    locally; `src/data-access/applications.ts` writes the union inline at
    3 sites. As more data-access modules accept optional `tx`, the
    duplication compounds.
  - Resolve via: add one export in `src/db/index.ts`, migrate the
    inline unions in `applications.ts`, swap the local alias.

- **Shared test fixture builder for Isometric submission tests**
  (`tests/isometric-submission-fixtures`)
  - `tests/isometric-submit-removal.test.ts`,
    `tests/isometric-sources-mirror-flow.test.ts`, and
    `tests/isometric-ghg-statement-submit.test.ts` each repeat ~8
    `vi.mock(...)` declarations and a similar `beforeEach`
    `mockResolvedValue` block. They evolve together — a new data-access
    dependency in `submit-removal.ts` typically breaks all three.
  - Resolve via: `tests/fixtures/isometric-submission-mocks.ts` exporting
    `applyIsometricSubmissionMocks()` (the `vi.mock` list) and
    `setDefaultSubmissionMockData(overrides?)` (the `beforeEach`
    defaults). Note `vi.mock` factories are hoisted, so each test file
    still calls them in its hoisted section — the shared module exposes
    the path list and the per-test default data.

- **Per-column upload-URL field migration** (`storage/phase-2`) — opened 2026-05-19
  - `production.plc_data_file_url`, `samples.r0_histogram_file_url`,
    `samples.tga_thermogram_file_url`, `production_samples.photo_url`,
    `feedstock.registry_url`, `emissions.source_url` are still plain
    text columns. Phase 2 plan: add a `*_document_id` FK alongside each,
    backfill via UI, drop the URL column.
  - Why: route all uploaded evidence through the single `documents`
    table (one audit trail, one storage-key convention, one
    visibility/ACL model).
  - Not urgent; existing URL fields keep working as external/legacy
    links via the `/api/documents/[id]` proxy route's fileUrl branch.

- **Per-Datapoint ledger sub-rows** (`isometric/phase-4`) — opened 2026-05-05
  - Add `submissionType='datapoint'` rows in `certification_submissions`
    so a re-submit short-circuits successfully-POSTed datapoints from a
    prior failed attempt.
  - Why: Phase 3 leaks orphan datapoints in Certify on partial-failure
    re-submits. The leaked rows have no Removal reference; they're
    cosmetic clutter, but not silent data quality issues.
  - Resolve only if partial-failure rates rise; the bookkeeping cost is
    real and not worth it for one-off recoveries.

- **PATCH `/removals` vs supersede-and-create** (`isometric/phase-4`) — opened 2026-05-05
  - Phase 3 always creates a new versioned remote Removal on payload
    changes (the supersede path). If Certify supports in-place PATCH for
    selected fields and verifier UX prefers it, branch 3e gains a PATCH
    path.
  - Why: more accurate audit trail when only metadata changes (no v=2
    Removal flooding the registry UI).
  - Resolve via reading Certify's PATCH docs and confirming with their
    team which fields are mutable post-creation.

- **`LIST` data-shape inputs receiving multiple datapoints** (`isometric/phase-4`)
  — opened 2026-05-05
  - `CreateComponentListInput.datapoint_ids[]` accepts N IDs, but Phase 3
    aggregation collapses N runs into a single value, so list inputs
    receive a one-element array. If a verifier asks for per-run datapoints,
    the aggregation step changes shape.
  - Why: today's protocol-level UX is "one credit batch = one Removal"
    with aggregated values; per-run is overkill but may be required for
    some templates.
  - Resolve only when a template surfaces that needs per-run breakdown.

### Phase 3.5 Sources panel test-pass follow-ups (opened 2026-05-27)

Surfaced while manually exercising the Sources panel against the
Isometric sandbox (Cases A–H). Cases A–E and the precondition guards
(Cases G/H) all passed; the three items below were either band-aided in
this PR or are clean UX deferrals.

- **`storage/sources-storage-loopback` — replace the HTTP loopback in
  `downloadDocumentBlob` with a `getObjectStream(key)` on
  `StorageProvider`.**
  - `src/fn/certification/sources.ts:368-387` issues a presigned URL,
    then `fetch`es it back from the same server. In dev that flows
    through `/api/storage/...` and requires `STORAGE_SIGNING_SECRET`;
    the round trip duplicates network and signing work that an internal
    stream would avoid entirely.
  - Resolve via: add `getObjectStream(key): Promise<{ stream, contentType, contentLength }>`
    to the `StorageProvider` interface (local-fs + S3 + GCS
    implementations), then have `downloadDocumentBlob` call it
    directly. Browser→storage signed URLs stay for genuine browser
    use; the server→storage path stops self-fetching.
  - Why: removes one HTTP hop per mirror, makes the loopback-host
    allowlist surface area smaller, and kills the dev-only
    `STORAGE_SIGNING_SECRET` dependency for this code path.

- **`storage/sources-sync-events-tx` — move `certifier_sync_events`
  writes out of the mirror business transaction.**
  - `safeAppendSyncEvent` (called inside `db.transaction` in
    `mirrorDocumentToSource`) currently calls `appendSyncEvent` on the
    root `db`. With a single-connection pool the audit write deadlocks
    waiting for a connection held by the open business transaction.
  - Band-aided this PR by setting `DB_POOL_MAX=10` in `.env.local`
    (audit writes go to a different connection). That's
    pool-size-dependent and shouldn't be the long-term invariant.
  - Resolve via: accumulate event payloads in a closure and flush them
    after the transaction settles (success or rollback). Audit always
    lands; no pool-size assumption. Touch points:
    `src/fn/certification/sources.ts` (`withSyncEventOnFailure`,
    `safeAppendSyncEvent`), `src/data-access/certification.ts`
    (`appendSyncEvent`).

- **`ux/sources-panel-row-layout` — buttons clip on narrow viewports.**
  - The Mirror / Unlink / visibility-toggle button row in
    `SourcesPanel` (`src/components/certification/sources-panel/`)
    clips below ~640px when filenames are long; reliably forced
    `javascript_tool` `btn.click()` over `computer.left_click` during
    manual testing.
  - Pure UX follow-up. Resolve via: wrap the action row, switch to
    icon-only on narrow viewports, or move buttons to a per-row
    overflow menu.

### Submit-removal — `pyrolyzer_direct` PROJECT-scope conflict in default template (opened 2026-05-27)

Encountered while running Sources-panel Case F (post-submit unlink
should fail-closed). Clicking SUBMIT on a Removal raised this SafeError:

> `This input belongs to a Project-scope Component (PROJECT scope,
> category="pyrolyzer_direct"). Remove
> "direct-emissions/ghg_direct_emissions/concentration" from the Removal
> Template; the corresponding emission is tracked as a Project Component
> published in the Isometric UI from a row in
> /admin/emission-estimates (ADR 0005)`

(Message wording since revised by ADR 0018 — it now points at the
Isometric UI directly; the journal it referenced was removed.)

- **Question:** the seeded default Removal Template still references the
  `direct-emissions/ghg_direct_emissions/concentration` input. Under
  ADR 0005 (scope) / ADR 0018 (ownership) the `pyrolyzer_direct`
  magnitude lives as a PROJECT-scope Component authored in the
  Isometric UI — the Removal payload must not carry that input. The
  check at submit time fails-closed correctly; the seed / default
  template carries a category that ADR 0005 said to remove.
- **Why it matters:** blocks Case F end-to-end test pass for the
  Sources panel, and any operator who tries to submit using the seeded
  default template hits the same error.
- **Resolve via:** update the default Removal Template seed (and any
  fixture template references) to drop
  `direct-emissions/ghg_direct_emissions/concentration` per ADR 0005,
  then re-run Case F. Track in the submit-removal phase; not a
  Sources-panel concern.
- **2026-06-03 update — stakeholder ask: why do we not have this data,
  and is an interim `0` acceptable?** Surfaced again hitting SUBMIT on
  `/certification/removals`. The root cause is upstream of the template:
  noma has **no source for the `pyrolyzer_direct` magnitude** (exhaust
  CH₄/CO concentration + gas mass flow). It is not operational
  production-run data — it comes from the annual external LCA, and no
  real extracted value has been published as a PROJECT-scope Component
  in Isometric yet. (The former `certifier_project_emissions` journal
  rows were Moshi-LCA placeholders; the journal is gone per ADR 0018 —
  the value now lives only where the operator publishes it in the
  Isometric UI.)
  - **The interim-`0` temptation is the exact integrity bug ADR 0005
    removed.** Pyrolyzer direct emissions are *positive* emissions that
    *reduce* net removal. Sending `0` (the old zero-stub behaviour)
    **inflates** the credit and is anti-conservative — the wrong
    direction for a registry. So `0` is not a neutral placeholder; it is
    an over-claim until the real LCA value lands.
  - **Stakeholder questions to resolve:**
    1. Who owns the LCA report, and what is the real `pyrolyzer_direct`
       value (kg CO₂e for the window) the operator should publish as a
       PROJECT-scope Component in the Isometric UI (ADR 0018)?
    2. Until that value exists, is the agreed interim posture (a) **omit
       the component from the template** so the Removal simply doesn't
       carry it (data absent, not a false `0`), or (b) a deliberately
       **conservative over-estimate** transcribed as a PROJECT-scope
       Component? Both are defensible; `0` is not.
    3. Does this block only sandbox exploration, or a real
       production submission? (Sandbox: unblock by editing the sandbox
       template only — no registry consequence.)
  - **Do NOT re-add a zero-stub `INPUT_MAPPING` entry to bypass the
    guard.** That reverts ADR 0005/0018 and re-introduces the
    over-claim. The unblock path is template-field removal, not a fake
    datapoint.

### Certify-removal redesign — pinned biochar protocol behind latest certified (opened 2026-06-04)

- `docs/isometric/versions.json` pins biochar `1.2.0`; a `protocols_analyze` on
  2026-06-04 resolved patch `1.2.2`, and biochar `1.3` is now **CERTIFIED**
  (2026-05-22) on the registry (some modules likewise have newer patches).
- **Why it matters:** the per-batch health check + submit payload encode
  1.2-line expectations; if 1.3 changes the required-input/evidence set or
  durability thresholds (H:Corg < 0.5, R₀ ≥ 2%, pollutant ceilings), they drift
  from the live protocol.
- **Resolve via:** an `update-playbook.md` pass evaluating 1.2 → 1.3 (refresh
  `requirements-shortlist.md` + `schema-mapping.md`, append to `changes.md`).
  Out of scope for the redesign build itself — but the redesign must not bake in
  1.2-specific numbers it doesn't already depend on.
- **Update (GHG-entry/statement audit, 2026-06-18 — held for findings only):**
  delta confirmed against the live registry and the certified changelogs.
  `versions.json` (generated 2026-02-09) pins biochar `1.2.0`, storage-soil
  `1.2.0`, energy-use `1.2.0`, ghg-accounting `1.0.1`. Latest CERTIFIED: biochar
  **1.3** (2026-05-22), which bundles **GHG Accounting 1.1**, **Energy Use
  Accounting 1.3**, and **Storage-in-Soil 1.3** (biomass-feedstock `1.3` +
  transportation `1.1` are unchanged — already current). **noma-specific impact
  is mostly low:**
  - **GHGAM 1.1 carbon-mass-balance (Procedure 4 — EC5/EC6, 12-month crediting
    window, batch tracking, corrective mechanism): largely N/A.** Procedure 4
    governs *co-product* allocation (biochar **+** a second creditable CDR
    product of different durability); noma is biochar-only and
    `buildMassAccounting` (`src/lib/certification/mass-accounting.ts`) does
    per-run *applied-mass* attribution, not a co-product split — only bites if a
    creditable co-product is ever added.
  - **GHGAM 1.1 20-year amortization cap + residual-debt reporting + mandatory
    year-1/3/5 reviews:** amortization is server-side (ADR 0005/0018 — Isometric
    owns project emissions end-to-end), so the cap is enforced registry-side.
    Low code impact; operator-process change; the journal removal planned in
    `docs/archive/plans/2026-06-17-remove-project-emissions-journal.md` was
    executed 2026-07-02 (ADR 0018).
  - **GHGAM 1.1 embodied-emissions LC-stage + staff-travel clarifications:**
    verify the ADR 0005 period-emission category definitions (staff travel is
    one) still match — doc-level.
  - **EUA 1.3** (hourly-matching removed for pre-2030 FID; added
    technical/feasibility tests) and **storage-soil 1.3 / protocol Appendix-4
    risk-of-reversal** (questionnaire/registry-determined): low noma code impact;
    buffer-split *numbers* may shift.
  - **The real work is registry-side, not in `versions.json`.** The protocol
    version is bound to the project's GHG-entry template in the Certify UI —
    editing `versions.json` migrates nothing. Sequence once the project moves:
    (1) re-author/re-bind the GHG-entry template to biochar 1.3 in Certify;
    (2) `pnpm isometric:coverage-check` → update `INPUT_MAPPING` (`datapoint.ts`)
    only if blueprint keys/inputs/units changed; (3) doc refresh per
    `update-playbook` (versions.json → shortlist → schema-mapping → changes.md);
    (4) `pnpm regenerate-certify-types` is separate (the OpenAPI surface is
    version-independent — likely no diff from the protocol bump alone).
  - **Decision dependency (why this stays open):** whether the project migrates
    to biochar 1.3 needs Isometric coordination + template re-authoring (existing
    1.2 removals may stay; new crediting periods may require 1.3). Authoritative:
    https://registry.isometric.com/protocol/biochar/1.3 . Full audit:
    `.tmp_pdf/isometric-ghg-integration-audit.html`.
- **Re-confirmation:** the `.claude/workflows/isometric-gap-check.js` run
  independently re-detected the same four drifts from a cold start and flagged
  no drift on biomass-feedstock or transportation — nothing has shifted; this
  stays the live re-pin decision (full run summary:
  `docs/archive/2026-06-22-isometric-gap-check-run.md`). That workflow is the
  standing re-audit mechanism — re-run it on any version bump to regenerate the
  three-corner (authority vs. docs vs. code) gap list before re-pinning.

### Certify-removal redesign — submit-context builder N+1 on selection/submit hot paths (`certification/submit-context-n+1`, opened 2026-06-05)

- Two N+1s remain in the shared submission-context builder (surfaced by the
  2026-06-05 CodeRabbit + audit pass): `loadSelectableBatchesForFacility`
  (`fn/certification/certify-context.ts`) loops a full `buildRemovalContext` per
  ungrouped batch — each iteration walks that batch's applications through
  `getChainOfCustodyData` (~6 queries/application) plus production-run and
  transport-leg loads; and `resolveScopeForRemoval` resolves member
  `applicationIds` + `co2eStoredPreview` per member (≈2×M queries).
- **Why it matters:** the New-Removal wizard's first step and the submit path;
  cost scales with batches × applications-per-batch. The per-batch Isometric
  *remote* calls were already hoisted, and the create-removal confirm loop was
  fixed in the same pass (`buildCreditBatchContextWithFacts` loads facility facts
  once) — what's left is the per-batch DB lineage fan-out.
- **Resolve via:** rework `buildRemovalContext` to batch the lineage walks across
  a batch set (one chain-of-custody resolve keyed by all `applicationIds`, one
  transport-leg query over all entity ids), or add a lighter projected
  fact-loader for the ungrouped-batch health verdict that doesn't need the full
  submission context. **Constraint:** `resolveScopeForRemoval` now intentionally
  does per-batch preview work because the submit summary needs
  `co2eStoredPreview` per member (the `0.0 tCO₂e` fix, 2026-06-05) — a
  grouped-`applicationIds` optimization must still supply the per-batch preview.
  The builder is shared with the submit pipeline (`submitRemoval`), so verify
  both paths. High-risk, deliberately deferred — wants a focused pass, not a
  mechanical edit.

### Certify-removal redesign — wizard robustness gaps (`certification/wizard-robustness`, opened 2026-06-05)

- Three failure-path gaps from the 2026-06-05 audit, all low-likelihood on a
  single-operator tool but each a surprising mode before a registry write:
  - **Submit double-fire:** `SubmitConfirmDialog.onConfirm`
    (`components/certification/new-removal-dialog/submit-step.tsx`) calls
    `fireSubmit(true)` unconditionally; a double-activate before `isPending`
    flips can fire the mutation twice. (Server submit is ~idempotent, which
    softens it; the primary Submit button is already `busy`-guarded.)
  - **Registry-guard error path:** `CertificationRegistryGuard`
    (`components/certification/certification-registry-guard.tsx`) ignores the
    certifier-summary query's `error` — a transient fetch failure reads as
    "no registry" and silently redirects the operator from every certification
    page to Settings (vs. a retry state). It also renders blank `null` while
    loading rather than a loading affordance.
  - **Batch-health TOCTOU:** `createRemovalWithBatchesAction` re-derives each
    batch's health *outside* the write transaction; the data-access write
    re-checks ungrouped/same-facility under `FOR UPDATE` but not health, so a
    batch could regress below `ready` between check and locked write. Health is
    a soft/derived gate, so impact is grouping a briefly-regressed batch.
- **Resolve via:** guard `onConfirm` with `if (submitMutation.isPending) return;`
  and disable the confirm action while pending; give the registry guard an
  explicit error/retry state distinct from "no registry" (and a loading
  affordance vs. bare `null`); for the TOCTOU, either re-assert
  `state === "ready"` inside `createRemovalWithCreditBatches` after acquiring the
  locks, or document health as a point-in-time advisory, not a write invariant.
  (Missing structured logs on the removal writes belong with the deferred
  observability work — see `Correctness / observability` below — not here.)

### Certify-removal redesign — TelemetryPanel orphaned, reactor-telemetry submit dark (`certification/telemetry-panel-orphaned`, opened 2026-06-19)

- `TelemetryPanel` still exists but is not rendered anywhere, so the reactor
  temperature/pressure -> Isometric `DataUploadSubmission` path remains dark.
  Archive: [`docs/archive/2026-06-19-telemetry-panel-orphaned.md`](archive/2026-06-19-telemetry-panel-orphaned.md).
- **Resolve via:** re-home and barrel-export `TelemetryPanel`, then validate the
  file-upload -> signed PUT -> data-upload-submission pipeline live on the
  sandbox before re-surfacing it.

## Audit follow-ups (opened 2026-05-25)

Batch of deferrals from the whole-codebase tech-debt audit run on
`feature/isometric-api` (CRITICAL + HIGH fixes landed in-PR; entries below
are the items that were flagged but kept out of that scope). Roughly
ordered by leverage.

### Architecture audit — remaining phases (opened 2026-05-21, plan archived 2026-06-03)

The 2026-05-21 `/ship AUDIT` plan
(`docs/archive/2026-05-21-architecture-audit-scalability-tech-debt.md`) was
partially executed: Phase 0 (PII log line, doc-query cap, parallel FK checks,
`max-lines` lint, `DB_POOL_MAX` docs, CI prod approval gate) and the
observability half of Phase 2 (structured logger) are done; Phase 4 split the
two oversized data-access files. The remainder is still open:

- **Phase 1 — schema-wide indexes.** Add `index()` for unindexed FK columns
  across the schema, time-series indexes (`productionRunReadings.timestamp`,
  `soilTemperatureMeasurements.measurement_date`), and the composite
  `transportLegs (entity_type, entity_id)`. One `pnpm db:generate` migration.
  (Superset of the narrower isometric-table composites in `perf/missing-indexes`
  below — fold those into the same migration.)
- **Phase 3 — read-path + correctness.** H5 explicit column selection on
  wide-table reads, full document pagination, a central `query-config.ts`,
  narrowed React Query invalidation, and `revalidatePath` on key mutations.
- **Phase 4 (remainder) — file size.** `seed-data.ts` (1165 LOC) and ~11
  oversized forms still exceed the 1000-line cap; then flip the `max-lines` lint
  from `warn` to `error`.
- **Phase 5 — CRUD/hooks de-duplication.** Same scope as `code/hooks-factory`
  below; optional, only worth it if the entity set keeps growing.

### Structural / cross-cutting

- **Duplicate-hooks factory** (`code/hooks-factory`) — opened 2026-05-25.
  - The `src/hooks/use-*.ts` family is ~4–5k lines of near-identical
    query/mutation wiring per entity. A `createEntityHooks(...)` factory
    would collapse most of it. (Carved out of the original `code/file-size-rule`
    entry, whose data-access file-size half is now resolved — see below.)
  - Resolve via: dedicated refactor PR — should not stack on top of
    in-flight feature work.

- **Single-tenant authorization → facility-membership model**
  (`security/facility-membership-authz`)
  - Acknowledged in `docs/isometric/integration-plan.md` pre-deploy
    gate #3. Every `data-access/{certification,
    certifier-removals,certifier-ghg-statements}.ts` accessor guards only
    with `requireAuth(userId)` — no facility-membership check. On a
    multi-tenant deployment, any authenticated user could enumerate or
    mutate any facility's rows by id.
  - Resolve via: introduce `requireFacilityAccess(userId, facilityId)`,
    update every data-access chokepoint, audit all `localEntityId`
    accessors in `certifier_sync_events` for the same shape.

- **Pin the document-redirect allowlist to the exact Isometric report bucket**
  (`security/redirect-host-pinning`)
  - The `/api/documents/[id]` redirect guard was narrowed (2026-06-03, see
    `docs/isometric/changes.md`) to `.s3.amazonaws.com` (+ regional/dualstack),
    `.storage.googleapis.com`, `.digitaloceanspaces.com`, `.isometric.com`. The
    S3/Spaces families still match **any** bucket on those providers, so an authed
    user could still store a `fileUrl` on an arbitrary bucket host. Low risk
    (browser 302; not request-attacker-controlled), accepted for now.
  - Resolve via: discover the exact host(s) Isometric presigns GHG-statement
    report URLs against (Isometric MCP `how_to` → certify OpenAPI report object,
    or inspect `documents.file_url` in a real environment) and set
    `ISOMETRIC_STORAGE_REDIRECT_HOSTS` to that explicit host per environment — it
    replaces the default families. No code change needed.

### Performance / scalability

- **Sequential datapoint POSTs in `submitRemoval`** (`perf/datapoint-fanout`)
  - `src/fn/certification/submit-removal.ts:576` iterates
    `transport.datapointBodies` and awaits each `createOrReconcile`
    sequentially — N × Isometric RTT per submission. With 5–15 monitored
    inputs per template this is 1–9s of avoidable wait per submission.
    `Promise.all` with `p-limit(4)` cuts wall-time ~Nx without
    overwhelming Isometric's per-second budget. Sync-event ordering
    becomes interleaved — trade-off the owner should call.

- **Missing composite index** (`perf/missing-indexes`)
  - `certifier_sync_events(entity_type, entity_id, attempted_at DESC)`
    has no index. Table grows ~2–3 rows per submission × ~20 submissions
    per facility per month; every detail page does a seq scan.
  - Resolve via: one migration adding the composite index.

- **CI coverage script serial per-facility loop** (`perf/coverage-check-fanout`)
  - The outer `for (const facility of facilities)` in
    `scripts/isometric-coverage-check.ts` iterates facilities one at a
    time; each runs 1× `listGhgEntryTemplates`. `p-limit(4)` over the
    facility array cuts CI wall-time linearly.

### Correctness / observability

- **Mapping-revision ambiguity on resume path** (`isometric/mapping-revision-resume`)
  - `submit-removal.ts:645,715` stamps the current `MAPPING_REVISION` on
    sync events emitted during the resume branch, but the actual
    datapoint bodies were built from `payloadSnapshot.__mappingRevision`
    (a potentially older deploy's mapping). An auditor querying
    `response_payload->>'mapping_revision'` cannot tell which mapping
    authored the bytes.
  - Resolve via: stamp both `snapshot_mapping_revision` (from
    `row.payloadSnapshot.__mappingRevision`) AND
    `runtime_mapping_revision` (current module constant) on every resume
    sync event. Minor JSONB shape addition, no migration.

- **Lossy `IsometricApiError` in submission catch paths** (`obs/preserve-error-context`)
  - `createOrReconcile` (`submit-removal.ts:721-749`) and
    `createGhgStatementRemote` (`ghg-statements.ts:287-326`) catch
    failures, write a `failed` sync event carrying only
    `errorMessage: message`, and throw a wrapped `SafeError`. The
    original `err.body`, `err.status`, `err.code` from
    `IsometricApiError` are dropped — neither the audit ledger nor any
    future logger receives them.
  - Resolve via: include `err.body`, `err.status`, `err.code` in
    `responsePayload` alongside `mapping_revision`; pair with the logger
    work above so the developer-facing stack and the operator-facing
    `SafeError` live in different channels.

### Accessibility

- **Color-only severity convention in warning notices** (`a11y/wcag-1.4.1`)
  - Warning notices (e.g. `BlockerNotice` in `certify-panel.tsx`) encode
    visual severity only by the `--color-signal-orange` left border + a
    decorative `!` glyph. WCAG 1.4.1 (use of color) requires a
    non-color cue; SR-only text satisfies AT users but the sighted-
    low-vision case still needs a non-color visual signal (e.g.,
    "Warning" inline text, an icon with sufficient contrast).
  - Resolve via: dedicated `audit-a11y` pass that also runs a runtime
    contrast check on `--color-signal-orange` against the white
    background, and that picks the project's house style for severity
    badges.

## Documentation hygiene

### Review feedback parked for future PRs (opened 2026-05-19)

- **`docs/isometric/changes.md` archival split** (`docs/changelog-archival`) —
  opened 2026-05-19, **deferred**.
  - Review suggested moving dated implementation-history sections (e.g.,
    2026-05-11 Phase 3.6 foundation, 2026-05-07 env/dialog refactor) out of
    `docs/isometric/changes.md` into `docs/archive/` and leaving only an
    evergreen status pointer in the original file.
  - Why parked: `changes.md` is documented in `CLAUDE.md` and
    `docs/isometric/README.md` as the project's local changelog. A
    changelog is dated by construction; splitting every entry into
    `docs/archive/` would defeat its discoverability without changing
    information density.
  - Resolve via: agree on a retention policy first (e.g., "entries older
    than 6 months move to `docs/archive/isometric-changes-<year>.md`"),
    then execute the cut in one PR rather than ad-hoc per review.

- **`docs/open-questions.md` dated-section extraction** (`docs/open-questions-format`) —
  opened 2026-05-19, **deferred**.
  - Review suggested moving "Pre-coding gates (status as of 2026-05-11)"
    and "Phase 3 blockers found in template inspection" into
    `docs/archive/` because they read as implementation logs.
  - Why parked: the file's documented entry shape (top of file) is
    `Title (area/topic) — owner, opened YYYY-MM-DD`. Dates are part of
    the contract, and the "Phase 3 blockers" entries are still partly
    open (sandbox zero stubs, electricity-readout schema work). They
    will leave this file when resolved, not when stale.
  - Resolve via: a dedicated pass that closes the still-open
    sub-entries (electricity readout, per-run GHG concentration,
    fuel-volume capture) so the parent gate can be removed.

- **`docs/isometric/README.md` and `sandbox-template-authoring.md` phase
  language** (`docs/evergreen-language`) — opened 2026-05-19, **deferred**.
  - Review flagged phase- or date-specific phrasing in the README index
    entry for `sandbox-template-authoring.md` and elsewhere.
  - Why parked low-priority: the phase references describe what the
    walkthrough *unblocks*, which remains accurate. Rephrasing is
    cosmetic; bundle with the next substantive update to the
    walkthrough (e.g., once a noma-mvp template ships and the doc is
    rewritten to reflect lived experience).

- **`env-banner.tsx` style-constant extraction** (`code/env-banner-style-consts`) —
  opened 2026-05-19, **deferred**.
  - Review suggested extracting padding (`px-12 py-8` / `px-16 py-12`)
    and icon-size (`16` / `20`) literals into named constants.
  - Why parked: only two call sites duplicate each literal, and the
    inline ternary makes the inline/page divergence immediately
    visible. Per `CLAUDE.md` ("Don't add abstractions beyond what the
    task requires"), this is below the threshold for extraction.
    Revisit if a third variant is added.

## Product bins & formulations

### Product-bin formulation claim-release policy (`product-bins/formulation`) — opened 2026-06-04, **deferred**

- A product bin (`storage_locations` of type `product_bin`) carries an
  optional `formulationId` enforcing "one formulation per bin" so bins stay
  clean (mirrors the existing `feedstockTypeId` "one feedstock type per bin"
  pattern). It is set at bin setup, or **claimed on first use**: the first
  formulated product placed into an unassigned bin sets the bin's
  `formulationId` (`createBiocharProduct` / `updateBiocharProduct` in
  `src/data-access/biochar-products.ts`).
- **Decision deferred:** the claim is currently a *persistent* reservation —
  nothing auto-releases it when the bin's last product is applied/removed or
  has its formulation changed. To re-purpose an emptied bin, an operator edits
  the bin and clears the formulation. `updateStorageLocation` guards that edit:
  it rejects clearing/re-pointing while the bin still holds product of a
  different formulation (`IS DISTINCT FROM`), so manual release is only allowed
  once the bin is genuinely free of conflicting product.
- **Why it matters:** without auto-release, a long-lived facility accumulates
  bins permanently tagged to old formulations, so they stop appearing as
  "unassigned" for new pure-biochar or different-formulation intake. Acceptable
  for now (manual release works); revisit if operators report bin churn.
- **Resolve via:** decide between (a) keep manual release (document as the
  intended model), or (b) auto-clear a bin's `formulationId` when its last
  matching product leaves (`deleteBiocharProduct` + the move-out path of
  `updateBiocharProduct`). If (b), record the decision and remove this entry.

## E2E walkthrough follow-ups (opened 2026-06-07)

Surfaced by a manual walkthrough of every entity + certification; most findings
were fixed in that pass and the remaining item below was deferred by product decision. The
dated run context and the registry counts that prompted these questions are
archived in
[docs/archive/2026-06-07-e2e-walkthrough-snapshot.md](archive/2026-06-07-e2e-walkthrough-snapshot.md).

### Certification view is local-first; doesn't mirror the registry (`isometric/registry-mirror`) — opened 2026-06-07, **deferred**

- The in-app cert view can show 0 removals / 0 GHG statements while the live
  sandbox registry holds drafts created out-of-band. Period math aligns (the
  app preview's "0 removals" for an open period matches the registry draft), so
  this is almost certainly **by-design**: the app surfaces only what *it*
  created, not the full registry state. (A concrete observed snapshot of these
  counts is archived in
  [2026-06-07-e2e-walkthrough-snapshot.md](archive/2026-06-07-e2e-walkthrough-snapshot.md).)
- **Why it matters:** the bare 0-counts can be misread as "the registry is
  empty" rather than "nothing created from here yet".
- **Resolve via:** decide between (a) a one-line note in the cert UI clarifying
  the local-first model (S), or (b) a read/sync view that mirrors existing
  registry removals/statements into the app (M–L). Likely (a); record the
  decision and remove this entry.
- **API note (2026-06-07):** option (b) is technically **unblocked** — the
  Certify API exposes `GET /ghg_statements` (active, cursor-paginated) and
  `GET /removals` (deprecated but functional, filterable by
  `supplier_reference_id`), plus single-`GET` variants. So a read/sync view is
  buildable; the open decision is product (do we want it), not capability.

### Isometric submission refs aren't stable across a DB reseed (`isometric/reseed-idempotency`) — opened 2026-06-07, **deferred**

- Submission idempotency **is implemented and correct within a DB lifetime**:
  `submission-claim.ts` locks drafts, refs are deterministic
  (`buildSourceSupplierRef` → `nm-src-{documentId}`), and
  `findRemovalBySupplierRef` + idempotent membership linking reconcile after a
  5xx instead of recreating. The gap: `supplier_reference_id` is derived from
  **local row UUIDs**, which `pnpm db:reset` regenerates → the dedupe lookup
  can't match the prior registry entity → re-submission creates a **duplicate**
  registry removal/source/statement. This is the likely cause of the sandbox
  project accumulating duplicate draft removals across test cycles (see the
  archived [walkthrough snapshot](archive/2026-06-07-e2e-walkthrough-snapshot.md)
  for observed counts).
- **Why it matters:** **sandbox-only today** — prod won't reseed, so refs stay
  stable and idempotency holds. It's a test-hygiene issue, not a production
  data-integrity bug. But it makes the sandbox registry a noisy mirror, and any
  future reseed-like prod event (restore from scratch, re-key) would silently
  duplicate.
- **Resolve via:** (a) accept it — sandbox drafts are harmless (0 credits
  issued); optionally clean them periodically (S); or (b) derive
  `supplier_reference_id` from a stable business key (the entity's `XX-26-NNN`
  code) instead of the row UUID, so re-submission after a reseed reconciles
  instead of duplicating (M). Likely (a) pre-launch. Record the decision and
  remove this entry.

## Audit follow-ups (whole-repo audit, opened 2026-06-07)

Deferred items from the 9-commit + working-tree audit — held back as needing a
product/UX decision or being larger than a review-fix. The audit pass's
execution summary (which high-severity findings were fixed) is archived in
[docs/archive/2026-06-07-whole-repo-audit-snapshot.md](archive/2026-06-07-whole-repo-audit-snapshot.md).
Sizing: (S) small, (M) medium, (L) large.

### Unbounded readings table — pagination/virtualization (`perf/readings-table-unbounded`) — opened 2026-06-07, **deferred**

- The `(production_run_id, timestamp)` index **landed** (migration `0036`), so the query
  is no longer a full scan. Still open: `getProductionRunReadings` has no `.limit`, and
  `production-run-reading-table.tsx` renders every row to the DOM with no virtualization.
  Telemetry is the highest-cardinality child entity on a run.
- **Why it matters:** a run with thousands of readings ships the whole set to the client
  and paints every row. Not biting yet at seed scale; will bite as real telemetry lands.
- **Resolve via:** decide server-side paging UX (page size, infinite-scroll vs. pages),
  then add `.limit`/offset + `@tanstack/react-virtual` (M). UX decision first.

### Certification readiness loader lineage fan-out (`perf/overview-lineage-nplus1`) — opened 2026-06-07, **deferred**

- `loadCertificationOverview` rebuilds a full submission context per removal; each walks
  every application through `getChainOfCustodyData`, which issues ~5–6 sequential single-row
  queries → on the order of R×A×6 round-trips per Removals load, uncached. Same root
  pattern as the per-batch `getCo2eStoredPreview` fan-out (`credit-batches.ts:380`) and the
  per-row `getCreditBatchById`/`getLatestSubmission` loops in `certify-context-core.ts`.
- **Why it matters:** the Removals hub readiness payload grows linearly with
  removals×applications; every navigation to Removals re-runs the full fan-out.
- **Resolve via:** batch lineage with set-based `inArray` queries (delivery→order→
  product→run in one pass, zip in JS) and/or memoize the readiness payload (React Query
  staleTime or a server cache). The batched primitive `getCreditBatchSummariesByRemovalIds`
  already exists as a model (L). Owner decides read/write/cache tradeoff.

### create-removal idempotency key (`concurrency/create-removal-idempotency`) — opened 2026-06-07, **deferred**

- `createRemovalWithBatchesAction` has no server-side idempotency key. Batch double-link is
  already race-safe (rows locked `FOR UPDATE`, re-checked `removalId IS NULL`), and the UI
  Confirm button is `busy`-gated, so single-tab and same-batch-set retries are covered. The
  residual gap: a network retry or a second tab submitting a **disjoint** batch set can create
  an extra `certifier_removals` row, and `gcRemovalIfOrphaned` only reaps on delete, not create.
  A creation **log line** was added in the audit pass; the dedupe key was not.
- **Why it matters:** narrow exposure (no batch double-spend, no bad credits — just a stray
  empty/duplicate removal), but it needs product semantics to close cleanly.
- **Resolve via:** add optional client-generated `idempotencyKey` to
  `createRemovalWithBatchesSchema`, persist with a unique index, `INSERT … ON CONFLICT
  (idempotency_key) DO NOTHING RETURNING id` inside the existing txn (M). Local Postgres
  dedupe only — the Isometric POST happens later in `submitRemoval`, no upstream idempotency
  header applies here.

### Inline-CRUD table duplication (`refactor/inline-crud-table`) — opened 2026-06-07, **deferred**

- The three production-run child tables (readings/incidents/samples) share ~90% boilerplate:
  identical `inlineForm` discriminated-union state machine, header markup, `TableSkeleton`,
  empty state, edit/delete column, and `DeleteConfirmDialog` wiring. `formatTimestamp` is
  copy-pasted 3×.
- **Why it matters:** maintenance drift — a fix to one table's CRUD flow has to be mirrored
  3× (this audit already had to touch all three together for the `readOnly`/loading changes).
- **Resolve via:** extract a generic `<InlineEntityTable>` or `useInlineCrudTable` hook
  parameterized by columns + form component + mutation hooks; per-entity files collapse to a
  config (M). Deliberately not done as a review-fix — pure refactor, no behavior change, wants
  its own PR + test pass.

### Generic typing for the certify field registry (`types/certify-registry-generic`) — opened 2026-06-07, **deferred**

- `certify-field-registry.ts` condition/`formFields` lookups are keyed by bare strings probed
  via `(entity as Record<string, unknown>)[field]` in `entity-readiness.ts`. A typo in a
  registry key compiles fine and silently reads `undefined` → readiness gate passes when it
  shouldn't. This class of bug is exactly what produced the original **MRV durability gap**
  (now fixed at the data layer + covered by a regression test in
  `tests/isometric-certify-context.test.ts`).
- **Why it matters:** the focused regression test closes the *known* instance; the *class*
  remains open — another mistyped key would fail the same silent way.
- **Resolve via:** make the registry generic per entity — `CertifyFieldDescriptor<T>` with
  `condition.field: keyof T` and `formFields: readonly (keyof T)[]`, and
  `deriveEntityCertifyReadiness<T>` bound to the real row type per entity kind, so every key
  becomes a compile-checked property reference (M). Judged not worth doing solely to satisfy
  the audit now that the root cause has a test; revisit when the registry next grows.

### Minor: correlation-id field drift in removal submit (`observability/submit-correlation-id`) — opened 2026-06-07, **deferred**

- The removal submit flow binds `submissionAttemptId` on its child logger but several deeper
  boundary logs key the correlation field as `submissionId` (the DB row id) instead — an
  aggregator filtering on one won't see records keyed by the other. No data loss; weakens
  "trace one attempt end-to-end." `ghg-statements.ts` already uses `submissionAttemptId`
  consistently.
- **Resolve via:** thread the attempt-scoped `log` child (which already carries
  `submissionAttemptId`) through those boundary logs, or include both ids (S).

## E2E robustness follow-ups (opened 2026-06-10)

Deferred from the e2e-reliability pass that split live-sandbox specs out of PR
CI (`@live` tag → nightly `e2e-live.yml`) and fixed the stale full-chain
selectors (EntitySelect migration, auto-matched credit-batch applications).

### Graceful degrade for invalid Isometric project links (`certification/invalid-project-422`) — opened 2026-06-10

- A facility linked to a project id the registry rejects (404/422) makes
  `safeListIfConfigured` re-throw, and React Query retries the failing server
  action — repeated real API calls and a degraded page instead of a calm
  "project not resolvable" state. Surfaced in CI when fake-project specs ran
  with real creds loaded; same behavior would hit prod on a stale/revoked link.
- **Already handled:** `ghg-statements-list.tsx` derives `mappingFailed` from
  the failing summary query and shows a warning banner, and
  `deriveRemovalReadiness` (`src/lib/certification/readiness.ts`) already
  blocks readiness when `!facts.hasMapping`.
- **Still open:** `safeListIfConfigured` (`src/fn/certification/shared.ts`),
  the project-scoped listing path — treat 404/422 as non-retryable, return an
  empty/flagged result instead of throwing, and surface a warning chip on the
  registry-connection card (M).

### Hermetic local stub for the Isometric client (`testing/isometric-stub`) — opened 2026-06-10

- `BASE_URLS` in `src/lib/isometric/client.ts` is hardcoded, so the @live specs
  can only run against the real sandbox; devs without `ISOMETRIC_DEMO_PROJECT_ID`
  silently skip them, which is how the Settings/mapping specs drifted unnoticed.
- **Resolve via:** a test-only base-URL override + a small fixture stub server
  (started from Playwright globalSetup) serving canned project/template
  responses, so the certification flows run hermetically everywhere (M).

### Unprompted "Link Isometric project" modal after facility create, CI prod build only (`facilities/phantom-link-dialog`) — opened 2026-06-10

- `FacilityCertifierDialog` opens unprompted over `/facilities` after facility
  create, on GitHub-runner production builds only (6/6 there, 0 local repros).
  Needs reproduction and a bisect; if real, it's a user-facing bug. Full CI
  forensics (PR #167 run analysis, trace/DOM evidence, replication matrix)
  archived in
  [docs/archive/2026-06-10-phantom-link-dialog-investigation.md](archive/2026-06-10-phantom-link-dialog-investigation.md).
- **Interim quarantine:** `facilities.spec.ts` dismisses the modal if present
  (loud `phantom-link-dialog` test annotation); remove when resolved.
- **Resolve via:** CI-side instrumentation — temporary `--trace on` first
  attempt, or a debug step dumping the React owner chain of the dialog node
  when present (component names need a non-minified build to be readable) (M).

### Playwright hygiene (`testing/e2e-hygiene`) — opened 2026-06-10

- `waitForLoadState("networkidle")` is used throughout `full-chain-ui.spec.ts`
  (slow-by-design with polling queries); shard 1 carries all `certification-*`
  files because sharding distributes by file. Consider `fullyParallel: true`
  (shard by test) after confirming no in-file ordering deps, replacing
  networkidle waits with role-based expects, and `eslint-plugin-playwright` (S).

## Tooling & toolchain upgrades (research pass, opened 2026-06-12)

Verified findings from a sourced research sweep (Next 16 / TS 7 / Drizzle v1,
mid-2026). Already confirmed fine: Turbopack default (no stale flags, no
webpack config), `reactCompiler: true` opt-in, `src/proxy.ts` rename,
generate+migrate CI workflow.

### TypeScript 7 (tsgo) for CI typecheck (`tooling/ts7`) — opened 2026-06-12

- TS 7's native Go compiler benchmarks ~7.5–10x faster full type-checks
  (first-party numbers; partly multi-threading). Beta is live
  (`@typescript/native-preview`, `tsgo` CLI, supports `--noEmit`); stable was
  planned ~June 2026 but had not shipped as of 2026-06-12 (npm latest = 6.0.3).
  Emit gaps are irrelevant here (typecheck-only; SWC/Turbopack transpiles), but
  no Strada compiler-API support — inventory API consumers first.
- **Resolve via:** add a non-blocking `tsgo --noEmit` CI job now to validate
  parity against the 60+-table schema and Zod-heavy types; flip the blocking
  typecheck to TS 7 once stable ships (S).
  Sources: devblogs.microsoft.com/typescript/announcing-typescript-7-0-beta,
  …/progress-on-typescript-7-december-2025.

### Drizzle ORM/Kit v1.0 upgrade (`db/drizzle-v1`) — opened 2026-06-12

- v1 is at `1.0.0-rc.3` (2026-05-18; stable line still 0.45.x). Bundles a full
  drizzle-kit rewrite (introspection ~10s → <1s — relevant at 60+ tables),
  migrations folder v3 (journal.json removed, per-migration folders, ends git
  conflicts on migrations), and Relational Queries v2 (breaking; official
  v1→v2 guide). Release notes warn "something will definitely break".
- **Resolve via:** do NOT adopt at RC. When stable ships, dedicated upgrade
  branch; the no-prod-data reseed-over-migrate stance makes the
  migrations-folder restructure cheap if done before launch (M).
- Related, available now on 0.45/kit 0.31: first-class Postgres RLS
  (`pgPolicy` auto-enables RLS) — candidate defense-in-depth layer for the
  planned multi-tenancy `organizationId` scoping (ADR 0010).

### Cache Components pilot (`app/cache-components`) — opened 2026-06-12

- Next 16 caching is fully opt-in via `cacheComponents: true` ('use cache' +
  PPR model; `cacheLife`/`cacheTag` now stable, old PPR flags removed). For an
  auth-gated, facility-scoped app there's no urgency, and no verified
  real-world adoption evidence for auth-heavy apps yet.
- **Resolve via:** selective pilot on read-heavy views (dashboard,
  chain-of-custody roll-ups) when perf data justifies it; not codebase-wide (M).

### Unverified research areas needing a follow-up pass — opened 2026-06-12

Lint tooling (Biome 2 / oxlint vs ESLint 9), Vitest 4 browser mode, Playwright
1.58+ features (test agents, trace tooling), OpenAPI contract testing for the
Isometric client, Renovate vs Dependabot, pnpm supply-chain guidance updates —
the research sweep produced no adversarially-verified claims in these areas.
