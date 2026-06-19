# 200-Year Durability Submission & Sampling-Method Enforcement

**Date:** 2026-06-18
**Status:** Plan — all decisions finalized 2026-06-18; ADR 0013 accepted. **A0 RESOLVED 2026-06-18** (§4): durability inputs go to the dedicated `biochar_sequestration_200_year_{c_org,unsampled}` blueprints via **datapoints / measurement samples**, *not* `INPUT_MAPPING` on `carbon_rich_substance_sequestration`. This **revises D1/D2/D5a/D6**; the reconciliation pass is now complete (2026-06-18): D2/D5a (per-batch lists), D6 (blueprint selection), and the **soil-temp model — resolved to a conservative estimate** (site max + 7 °C floor, surfaced as such) are all confirmed (§4). **§6 is now phased (Phases A–H); branch `feat/200yr-durability-submission` created. Phases A–D, G and H plus the Phase E *offline* path are implemented and committed (a9a6710…26fb036); Phase F (UI surfaces) browser-verified and committed (8207862). The ONLY remaining work is Phase E's LIVE measurement-samples submit wiring, still sandbox-gated on two confirms (datapoint↔component-input binding; H/C ×100 unit transform — doc evidence now leans dimensionless/explicit-reference, see `open-questions.md`).** **A0 fully resolved (§4):** template **re-authored 2026-06-18** (operator) and the live coverage-check confirmed the exact tuples — group `co2-stored`, both biochar 200-yr blueprints, 5 inputs each (`h_c_molar_ratios`, `total_carbon_contents`, `inorganic_carbon_contents`, `soil_temp`, `product_mass`). The measurement-sample↔component wiring is a build-time empirical task, not a blocker. **Out of scope (deferred, §7):** the same coverage-check surfaced a pre-existing ADR 0005 **scope-conflict** bug (project emissions declared removal-scope) → **separate P0 round**, independent of this build.
**Pathway pins:** biochar protocol **1.2.0**, `biochar-storage-soil-environments` **1.2.0** (`docs/isometric/versions.json`)

---

## 1. Goal

Make noma's removal / GHG-entry submission carry **everything the Isometric registry
needs to compute the 200-year durable fraction itself**, and turn the biochar
**sampling-method** requirements (Method A / Method B) from captured-but-unenforced
policy into real gates. Scope is **200-year durability**; 1000-year is deferred (§7).

## 2. Authoritative basis (verify against the URLs before coding)

All non-authoritative; cite section + URL in code headers.

- **CO₂e_stored (Eq. 1):** `CO₂e_stored = C_biochar × m_biochar × F_durable × 44.01/12.01`
  — `biochar-storage-soil-environments/1.2` §5.
- **C_biochar (Eq. 2):** `Total Carbon − C_inorg` (organic carbon only is credited).
- **F_durable,200 (Eq. 3):** `min(0.95, 1 − [c + (a + b·ln(T_soil))·H/C_org])`,
  `a=−0.383, b=0.350, c=−0.048`, 7 °C soil-temp floor, 0.95 cap. **Inputs: soil
  temperature + molar H/C_org only.** noma already implements this locally in
  `src/lib/calculations/biochar-removal.ts`.
- **Eligibility gates:** H/C_org **< 0.5** AND O/C_org **< 0.2** (module §3, Table 2).
- **Sampling:** Method A = sample **every production run**; Method B = **≥1 per 10
  runs** after a **30-Method-A-sample** baseline (protocol §8.3.2). Each sampling
  needs **≥3 replicates** (module §4, "composite divided into ≥3 representative
  replicates per batch").
- **Aggregation:** C_biochar is determined **per production batch then aggregated
  mass-weighted** to the reporting period; the durability equation is applied to the
  aggregated value. Method A/B does **not** change the aggregation math.
- **Soil-temperature conservatism (module §5):** *"If the soil temperature variation
  within a project boundary exceeds 1 °C then The Project must be further divided, or
  the most conservative temperature value (i.e., highest)… must be used."*
- **Durability tiers:** only **200-year** and **1000-year** exist. **There is no
  100-year option** under Isometric — 100-year permanence belongs to other standards
  (Puro / EBC) and to GWP-100, neither of which this system credits against.

### Current-state findings (verified in code, 2026-06-18)

The gap is **narrower than "capture + send"** — most of the data plane already exists:

- **Durability inputs are already captured, conditionally-required, and DB-checked** when
  `durability_option = 200_year`: `credit_batches.h_to_c_org_ratio` (batch) and
  `applications.soil_temperature_c` + `soil_temperature_source` (site). See
  `condition-registry.md` `durability.200_year`, enforced in `src/schemas/isometric.ts`.
- **Aggregation already computes `weightedHToCorgRatio`** (mass-weighted,
  `src/lib/isometric/utils/aggregation.ts`) alongside `weightedOrganicCarbonPercent` —
  then **drops it at submission** (INPUT_MAPPING emits only `carbon_content` +
  `product_mass`).
- **Soil temperature is NOT aggregated** at removal level (`AggregatedProductionData` has
  no soil-temp field) → the conservative-max rollup (D2) is genuinely net-new.
- **1000-year is data-capture-only:** sample fields (`randomReflectanceR0Percent`,
  `reactiveCarbonPercent`, `residualCarbonPercent`) + conditional validation exist, but
  there is **no `computeFDurable1000` engine** and no 200/1000 pathway segregation.

**Net:** the real work is (1) the soil-temperature rollup, (2) routing both inputs into
`INPUT_MAPPING` (A0-gated), and (3) promoting today's warnings into hard gates — not
building data capture from scratch.

## 3. Decisions (agreed — finalized 2026-06-18)

| # | Decision | Rationale |
|---|---|---|
| D1 | **Registry computes F_durable.** The GHG entry submits raw monitored inputs — `organic_carbon`, `product_mass`, **`h_to_c_org`**, **`soil_temperature`** — and Isometric runs Eq. 1 + Eq. 3 server-side. | Matches Isometric's audit + uncertainty/buffer model. Today we send only carbon + mass → the registry can't reproduce our durable fraction (over-credit risk). **See ADR 0013 (accepted).** |
| D2 | **Rollup rule:** `carbon_content` and `h_to_c_org` are **mass-weighted** across the removal's batches; `soil_temperature` is the **conservative max** across member application sites (subdivide if sites vary > 1 °C); `product_mass` is summed. Same for Method A and B. | Protocol aggregates carbon mass-weighted; only soil temperature has the explicit > 1 °C worst-case rule. Method A/B changes data density, not the formula. |
| D3 | **Hard blocks on removal submission (fail closed):** (a) **H/C_org < 0.5 AND O/C_org < 0.2** (per-run mean, see D8); (b) **every Method-A run** in the removal has ≥1 sample; (c) **≥3 replicates** per sampled run. | These are the registry's hard eligibility + sampling requirements; today all pass with only a logged warning (`aggregation.ts:192`). Closes P0-03 / P0-06. |
| D4 | **COA is required for the chemistry to count** (lab_report document attached + `labName`/`labAccreditation` populated), mirrored as the **Source** behind the chemistry datapoints. **CONFIRMED required (fail-closed), 2026-06-18.** | On the D1 path the COA is the evidence behind the exact H/C_org and carbon numbers driving durability. **Build note:** verify existing samples already carry COAs *before* turning the gate on, so it doesn't trap an in-flight removal. |
| D5 | **A Sample = one lab-analysed replicate.** A sampled run carries **≥3 Samples**; mean + std-dev are computed across them; **aggregation is per production run** (the pyrolysis batch). No new sample-table shape — existing aggregation already averages a run's samples. | Least disruption; gives std-dev a home (also feeds uncertainty + the 1000-year path later). |
| D5a | **Submitted H/C_org = the sample-derived `weightedHToCorgRatio`** (per-run, mass-weighted into the period), *not* the operator-declared `credit_batches.h_to_c_org_ratio`. The declared field is **reconciled** against the aggregated value with a divergence warning. | The measured, auditable figure already feeds the preview engine — submitting it means the preview and the credited number can't drift. Mirrors the carbon-reconciliation guard in `resolveOrganicCarbonPercent`. |
| D7 | **Durability tier = 200-year only** for this build. 1000-year deferred (§7). | Confirmed 2026-06-18. 1000-year needs Eq.4–6, R₀/TGA rollup with std-dev, a separate submission path + template inputs — out of scope until commercially needed. |
| D8 | **Eligibility (H/C_org < 0.5, O/C_org < 0.2) is judged on the production-run mean**, with any outlier replicate flagged (not a per-replicate hard fail). | Follows from per-run aggregation (D5); the run's characterization is its replicate mean. |
| D6 | **Sample-count requirement is *derived*, never stored** — computed from the reactor's **current** `samplingMethod` at readiness/submission time, so flipping the method auto-readjusts it. Applies to **all not-yet-submitted runs**; submitted removals stay frozen. | Requested by user. Requires building the **Method B ≥1/10 cadence** check (currently "Planned", `condition-registry.md:19`). |

## 4. A0 — RESOLVED (2026-06-18) + residual confirms

**Authoritative basis:** Isometric Component Blueprint Library + measurement-samples docs +
`biochar-storage-soil-environments` 1.2 module, **corroborated against**
`src/lib/isometric/generated/certify.d.ts` (the enums below exist verbatim).

**Finding — the durability inputs do NOT live on `carbon_rich_substance_sequestration`.**
That blueprint carries only `carbon_content` + `product_mass`. The registry computes
`F_durable` on **dedicated biochar sequestration blueprints**:

- **`biochar_sequestration_200_year_c_org`** — sampled batches; registry takes the **mean**
  of the H/C list.
- **`biochar_sequestration_200_year_unsampled`** — Method B; registry uses a **Winsorized
  mean + standard error**.

Both declare these **monitored inputs** (new values per GHG entry):

| blueprint input | meaning | quantity kind | unit |
|---|---|---|---|
| `h_c_molar_ratios` | molar H/C_org | Dimensionless Ratio **List** | `%` |
| `soil_temp` | mean annual soil temperature | Temperature | `degC` |
| `total_carbon_contents` / `inorganic_carbon_contents` / `product_mass` | C_biochar + mass | — | — |

The blueprint equation is noma's `computeFDurable200` verbatim:
`non_durable = −0.048 + (−0.383 + 0.35·ln(soil_temp))·h_c_molar_ratios; durable = min(0.95, …)`.

**Submission mechanism — datapoints, surfaced as measurement samples (NOT `INPUT_MAPPING`):**
- The single source of truth is a **datapoint** (magnitude, unit, std-dev, sources).
- A **measurement sample** groups datapoints under a `MeasurementTypeKey`:
  - H/C_org → `biochar_production_batch`, property `{quantity_kind: dimensionless_ratio,
    qualifier: hydrogen_to_organic_carbon_ratio}`, **per production batch**.
  - soil temp → `biochar_soil`, property `{quantity_kind: temperature}`, **per project area**
    (annual avg; 7 °C floor; subdivide if sites vary > 1 °C).
- The blueprint component input references those same datapoints by id.
- noma's types already carry both measurement types + qualifiers, the `/measurement_samples`
  POST, and the `MeasurementProperty` encoder (`utils/measurement-property.ts`, used today by
  `sensors.ts`). **No `regenerate-certify-types` needed.**

**Residual confirms — RESOLVED 2026-06-18:**

1. **Template binding — DONE (re-authored 2026-06-18):** operator added "Biochar
   sequestration, 200 year durability" + "…, unsampled batch" and deleted
   "Carbon rich substance sequestration". **Consequence:** `INPUT_MAPPING` now references a
   deleted blueprint, so live submission is **fail-closed** until the measurement-samples path
   (work item 5) lands — expected mid-migration state (not-live, no prod data). Next: run
   `pnpm isometric:coverage-check -- --source=db` to capture the new template's exact
   `(group, blueprint, input)` tuples + units and finalize the mapping spec.

   *(Original finding, retained for context:)* The current
   `carbon_rich_substance_sequestration` component carries only carbon + mass and computes
   **no** durable fraction, so the registry can't compute `F_durable` today. The two biochar
   blueprints are split by **whether a batch was lab-sampled**, *not* by method (verbatim
   descriptions):
   - **`biochar_sequestration_200_year_c_org`** ("Biochar sequestration, 200 year durability")
     — a batch with its **own** carbon-content + durable-fraction **measurement**.
   - **`biochar_sequestration_200_year_unsampled`** ("…, unsampled batch") — "unsampled
     batches where carbon content and durable fraction are **calculated based on historically
     sampled batches**. Applicable to projects sampling using **Method B**." (Winsorized
     mean − SE on carbon; Winsorized mean **+** SE on H/C → leans conservative.)

   So: **Method A** (sample every batch) → only `_c_org`. **Method B** (≈1-in-10) → sampled
   batches use `_c_org`, the un-sampled remainder use `_unsampled`. **Decision: author the
   template with BOTH** blueprints (future-proofs the D6 method-flip; a Method-A-only project
   would need just `_c_org`). Replace `carbon_rich_substance_sequestration`. Open authoring
   nuance: whether one template cleanly carries both sequestration components and how a GHG
   entry selects per-batch — confirm while authoring in Certify; validate after with
   `pnpm isometric:coverage-check`.
2. **Wiring obligation — reclassified as a build-time empirical task, not a user decision.**
   The OpenAPI shares `datapoint_id` across measurement samples and component inputs, so the
   model is almost certainly "one datapoint, referenced by both." Confirm the exact binding
   (auto-link vs explicit reference) against the **sandbox** when building the submission
   path; not a blocker for planning.

Authoritative: blueprint library
`https://docs.isometric.com/user-guides/certify/component-blueprint-library` · measurement
samples `https://docs.isometric.com/user-guides/certify/measurement-samples` · module §"Option
1: 200 Year Durability" `https://registry.isometric.com/module/biochar-storage-soil-environments/1.2`.

### Coverage-check output — confirmed live (2026-06-18, sandbox template `rvt_1KS4S43VPSBXA26X`, project `prj_1K9YJ33RKSBX9FFF`, 33 monitored tuples)

**Durability tuples (the build spec — group `co2-stored`, both blueprints present):** each of
`biochar_sequestration_200_year_c_org` and `biochar_sequestration_200_year_unsampled` exposes
**5 inputs**: `h_c_molar_ratios`, `total_carbon_contents`, `inorganic_carbon_contents`,
`soil_temp`, `product_mass`.

- **Refinement — carbon is submitted as TWO inputs, not a pre-computed organic figure.** The
  template wants `total_carbon_contents` **and** `inorganic_carbon_contents` (both per-batch
  lists); the registry computes `carbon_contents = total − inorganic` (Eq.2) itself. So our
  current `carbon_content ← weightedOrganicCarbonPercent` mapping is replaced by two list
  inputs from the samples' `totalCarbonPercent` + `inorganicCarbonPercent`. **Schema note:**
  `samples.inorganicCarbonPercent` is currently *optional* — confirm it's required (or
  defaulted to 0) since the blueprint input expects it.
- **Unit watch:** `h_c_molar_ratios` carries unit `%` in the blueprint — our samples store a
  dimensionless ratio (~0.5). The transformer's `expectedQuantityKind`/unit check will force
  us to resolve any ×100-style transform at build time (cf. the existing `carbon_content /100`).

**SEPARATE pre-existing bug surfaced — ADR 0005 scope conflicts (NOT caused by the re-author).**
This is the first time the coverage-check ran against the live template (the CI fixture is
empty), so these were latent. The template declares several **PROJECT-scope** period-emission
categories as **REMOVAL-scope** monitored inputs — they must be **removed from the removal
template** and live as Project Components instead (ADR 0005):
`direct-emissions/ghg_direct_emissions/{concentration,mass_flow}` (pyrolyzer_direct),
`sampling-required-for-mrv/mass_based_ci_emissions/mass` (sampling_consumables),
`sampling-required-for-mrv/grid_electricity_use/electricity_use` (lab_electricity),
`staff-travel/distance_based_ci_emissions/distance` (staff_travel),
`miscellaneous/mass_based_ci_emissions/mass` (miscellaneous). **Risk if left:** project
emissions would be attributed per-removal instead of amortized at project level.
**Decision (2026-06-18): DEFERRED to a separate P0 round** — explicitly **out of scope for
this durability build**; the two concerns are independent (durability can ship without it).
Operator has candidate approaches to discuss. Tracked in §7; resolution = remove these from
the removal template and model them as Project Components (ADR 0005); relates to
`docs/archive/plans/2026-06-17-remove-project-emissions-journal.md`.

### Decisions revised by the A0 findings (confirmed 2026-06-18 in the reconciliation pass)

The §3 table is left intact; these are the deltas the A0 facts force. **All three
reconciliation points (D2/D5a lists, soil-temp model, D6 blueprint selection) were confirmed
2026-06-18; the soil-temp model resolved to a conservative estimate — see below.**

- **D1 (mechanism):** principle holds (registry computes `F_durable` from raw inputs), but
  the target is the `biochar_sequestration_200_year_*` blueprint via **datapoints /
  measurement samples**, *not* new `INPUT_MAPPING` entries on
  `carbon_rich_substance_sequestration`. Build a measurement-samples submission path
  (mirror `sensors.ts`).
- **D2 (H/C rollup) — partly overturned:** do **not** pre-aggregate H/C to one mass-weighted
  scalar. Submit the **list** of per-batch H/C datapoints (each carrying its std-dev from the
  run's ≥3 replicates) and let the registry mean it (`_c_org`) / Winsorized-mean+SE
  (`_unsampled`). Protocol aggregation is a (Winsorized) **mean of per-batch ratios**, not
  mass-weighted — confirm per-batch-mean vs per-replicate submission.
- **D2 (soil temp) — model mismatch → RESOLVED (conservative estimate, 2026-06-18):** the
  protocol's ideal is a **project-area annual average** (≥10 measurements/site-month, or a
  global DB) recorded in the PDD. noma has only per-application `soil_temperature_c` and **no
  project-area baseline data source**. **Decision:** submit a single **conservative estimate**
  = the **max** `soil_temperature_c` across the removal's application sites (higher T_soil →
  lower F_durable, the protocol's own worst-case rule, module §5), keeping the **7 °C floor**
  and a **> 1 °C-spread "subdivide" warning**. **This is an explicit conservative approximation,
  not a measured project-area average, and MUST be surfaced as such** — carry a
  `conservativeEstimate` flag + a short method string through aggregation so Phase F can show a
  visible "conservative estimate" note/badge by the durability figure and in the submission
  preview, and Phase E can record the method in the `biochar_soil` measurement-sample/datapoint
  `description`. Revisit a true project-area baseline entity only if a verifier requires it.
- **D5a:** `weightedHToCorgRatio` becomes a **preview-only** value; it is no longer the
  submitted figure (the registry aggregates the list itself).
- **D6 (Method A/B → blueprint selection):** sampled batches submit to
  `biochar_sequestration_200_year_c_org`; Method B unsampled batches submit to
  `biochar_sequestration_200_year_unsampled`. The blueprint choice *is* the A/B distinction
  at submission.

## 5. Glossary (already updated in `CONTEXT.md`)

New "Sampling, characterization & durability" section: **Sample**, **Replicate**,
**Method A / Method B**, **Durability tier**, **Carbon-rich-substance sequestration**.
Key disambiguations recorded: Method A/B is *sampling frequency only*; sampling unit is
the **production run**, not the **credit batch**; no 100-year tier.

## 6. Work breakdown — phased

Phases are ordered by dependency. **Only Phase E's live wiring is sandbox-gated** (it needs the
`op`/1Password coverage-check the operator runs); every other phase is buildable offline.
Co-develop the matching tests inside each phase — the Phase H sweep is the final integration
pass, not the only testing. Branch: `feat/200yr-durability-submission` (created 2026-06-18).

### Phase A — Schema & validation gates  [WI1]
- `src/schemas/samples.ts`, `src/data-access/samples.ts`, `src/data-access/production-runs/*`.
- Eligibility thresholds **H/C_org < 0.5 AND O/C_org < 0.2**, judged on the **per-run mean**
  (D8), with any outlier replicate flagged (not a per-replicate hard fail).
- Per-run **replicate-count helper** (≥3, module §4).
- `samples.inorganicCarbonPercent` optional → **required** (or defaulted to 0): the template
  consumes `total_carbon_contents` AND `inorganic_carbon_contents` as separate inputs and
  derives organic via Eq.2 (§4 carbon refinement). Confirm existing samples carry it before
  hard-requiring, mirroring the COA build-note.
- Foundation for B–E.

### Phase B — Method-driven requirement engine  [WI2]  *(after A)*
- `src/lib/certification/readiness.ts` + `src/config/certification.ts`.
- Derive the required sample set from the reactor's **current** `samplingMethod` (D6 — never
  stored, so a method flip auto-readjusts); implement the Method B **≥1/10 cadence** (today
  "Planned", `condition-registry.md:19`); evaluate over **not-yet-submitted** runs only
  (submitted removals stay frozen).

### Phase C — Fail-closed submission gates + COA  [WI3]  *(after A, B)*
- `src/fn/certification/submit-removal.ts`.
- Promote D3 from logged warnings (`aggregation.ts:192`) to hard `SafeError` blocks:
  (a) eligibility; (b) every Method-A run in the removal has ≥1 sample; (c) ≥3 replicates per
  sampled run.
- Require **COA Sources** (D4): `lab_report` document attached + `labName`/`labAccreditation`
  populated, mirrored as the Source behind the chemistry datapoints. **Verify in-flight
  removals already carry COAs before enabling** so the gate doesn't trap a live removal.

### Phase D — Aggregation: per-batch datapoint lists + conservative soil-temp baseline  [WI4]  *(after A)*
- `src/lib/isometric/utils/aggregation.ts` (+ a new per-batch datapoint builder).
- Build the **list** of per-production-batch H/C_org datapoints (each carrying its std-dev from
  the run's ≥3 replicates) + per-batch `total`/`inorganic` carbon lists for the period — NOT a
  collapsed scalar (§4 D2 revision; registry means/Winsorizes the list itself).
- Resolve the **conservative soil-temp estimate** = max `soil_temperature_c` across the
  removal's application sites; 7 °C floor; > 1 °C-spread subdivide warning; carry a
  `conservativeEstimate` flag + method string for Phases E/F to surface (§4 D2 soil-temp
  resolution).
- `weightedHToCorgRatio` stays in `aggregation.ts` as a **preview-only** value (D5a), no longer
  submitted; reconcile the operator-declared `credit_batches.h_to_c_org_ratio` against it with
  a divergence warning.

### Phase E — Measurement-samples submission path  [WI5]  *(after D)*  ⚠️ live wiring SANDBOX-GATED
- New module under `src/lib/isometric/` mirroring `sensors.ts`; `POST /measurement_samples`
  (generated types already carry `CreateMeasurementSampleRequest` + the two `MeasurementTypeKey`s
  + `hydrogen_to_organic_carbon_ratio` qualifier — no type regen).
- Emit `biochar_production_batch` H/C samples (`hydrogen_to_organic_carbon_ratio`) + a
  `biochar_soil` temperature sample (its `description` records the conservative-estimate
  method); route them into the `biochar_sequestration_200_year_{c_org,unsampled}` blueprint
  inputs, blueprint chosen per Method A/B (D6).
- Replace the stale `carbon_rich_substance_sequestration` `INPUT_MAPPING` entry (currently
  fail-closed against the re-authored template — expected mid-migration).
- **Sandbox-gated empirical steps (operator runs `pnpm isometric:coverage-check -- --source=db`):**
  (1) the exact datapoint↔component-input binding (auto-link vs explicit `datapoint_id`
  reference); (2) the `h_c_molar_ratios` ×100 unit transform (template unit `%` vs our ~0.5
  dimensionless ratio). **Build the module + payload now; keep the live submit path behind
  these two confirms.** Papercut to fix while here: `scripts/isometric-coverage-check.ts`
  doesn't default `NODE_ENV` (add `process.env.NODE_ENV ??= "development"`).

### Phase F — UI surfaces  [WI6]  *(after A–C)*
- Reactor list/readiness: per-method sample requirement + met/unmet.
- Sample form: eligibility-threshold errors.
- Removal readiness: durability gaps.
- **Soil-temp conservative-estimate note:** a visible badge/note by the durability figure and
  in the submission preview making clear the submitted soil temperature is a **conservative
  estimate** (site max + 7 °C floor), not a measured project-area annual average.

### Phase G — Docs & changelog  [WI7]  *(after E offline parts land)*
- Close **P0-03** + **P0-06** (`p0-compliance-checklist.md`); update `schema-mapping.md` rows
  (200-yr inputs now submitted), `condition-registry.md` (cadence implemented),
  `requirements-shortlist.md`; append `isometric/changes.md`; remove the matching
  `open-questions.md` entry.

### Phase H — Integration test sweep  [WI8]
- eligibility-gate rejection; unsampled-Method-A-run block; <3-replicate block; method-flip
  re-derivation; soil-temp baseline + floor/subdivide + conservative-max + estimate flag;
  measurement-sample payload (per-batch H/C list + conservative project-area soil temp) and
  correct blueprint selection per Method A/B.

## 7. Deferred / out of scope

- **1000-year durability** (Eq. 4–6: R₀ + non-reactive carbon, std-dev): inputs are
  captured on samples but `computeFDurable1000` is unimplemented and there's no 200/1000
  pathway segregation. **Deferred — confirmed 2026-06-18 (D7).**
- ~~Per-batch (non-collapsed) durability submission — revisit if A0 shows the template
  accepts list/per-batch inputs.~~ **Resolved by A0 (2026-06-18): the template inputs ARE
  per-batch lists (`h_c_molar_ratios`, `total_carbon_contents`, …) — non-collapsed per-batch
  submission is now the chosen approach (see §4 D2 revision), not deferred.**
- **ADR 0005 scope conflicts on the live template (P0 — separate round):** the template
  declares ~5 project-emission categories (pyrolyzer_direct, sampling_consumables,
  lab_electricity, staff_travel, miscellaneous) as REMOVAL-scope monitored inputs, surfaced
  by the 2026-06-18 coverage-check (§4). They must be removed from the removal template and
  modeled as Project Components (ADR 0005). **Deferred to a dedicated P0 round** — operator
  has candidate approaches to discuss; relates to
  `docs/archive/plans/2026-06-17-remove-project-emissions-journal.md`. **Independent of the durability
  build** — does not block it.

## 8. To verify verbatim before coding

- §8.3 reporting-period aggregation equation for `CO₂e_stored,RP` (confirm mass-weighting
  wording).
- ~~Whether eligibility H/C_org < 0.5 is judged on the per-run mean or per replicate~~
  **Resolved (D8): per-run mean, outlier replicate flagged.**

## 9. ADR

**`docs/adr/0013-registry-computed-durable-fraction.md` — accepted 2026-06-18.** Captures
D1 ("noma submits raw durability inputs — H/C_org + soil temperature — and the registry
computes F_durable"), the rejected alternatives (pre-discounted CO₂e figure; precomputed
F_durable scalar), and the consequences (A0 dependency, rollup rules, sample-derived H/C
source per D5a, 200-year scope).
