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

## Isometric Certify integration

### Pre-coding gates (status as of 2026-05-06)

- **Datapoint with empty `source_ids`** (`isometric/phase-3`) — opened 2026-05-05, **RESOLVED 2026-05-05; SANDBOX RE-CONFIRMED 2026-05-06 ✓**
  - Confirmed: `POST /datapoints` with `source_ids: []` returns 2xx against the
    demo project (`prj_1K5F2F6SN1S0ZKDQ`). One smoke datapoint
    (`dtp_1KQVZYB741S02H7Y`, supplier_reference_id `nm-smoke-empty-src-…`)
    was created in production for verification — safe to delete via the
    Isometric UI.
  - Re-confirmed against sandbox project `prj_1K9YJ33RKSBX9FFF` on
    2026-05-06; smoke datapoint `dtp_1KQYVM2KRSBX2ZF6` was created.
  - Sources can stay deferred to Phase 3.5; Datapoints+Removal MVP is
    API-valid.

- **Live-template `INPUT_MAPPING` coverage** (`isometric/phase-3`) — opened 2026-05-05, **GAPS FOUND**
  - Ran `pnpm tsx scripts/isometric-smoke.ts inspect-template` against the demo
    project's two default templates ("Protocol default", "Biochar"). Findings:
    - **Fixed `carbon_content` mismatch — RESOLVED.** Blueprint expects
      `quantity_kind=dimensionless` / `unit=dimensionless` (a 0–1 fraction);
      mapping previously declared `mass_fraction` / `%`. Updated mapping with
      a `/100` transform from `samples.organicCarbonPercent`.
    - **20 monitored inputs not covered by `INPUT_MAPPING`.** See
      `isometric/phase-3-input-coverage` below for the full list and noma-side
      data availability per input.
    - **All `type=fixed` constants on the demo template are NOT pre-bound**
      (carbon_intensity, GWP, emissions_factor, etc.). `submitCreditBatch` now
      bails with a clear "bind constants in the Isometric template editor"
      message. Tracked separately under
      `isometric/phase-3-fixed-constants` below.
  - Sandbox re-check on 2026-05-06 against project `prj_1K9YJ33RKSBX9FFF`
    returned two templates (`Protocol default`,
    `Dark Earth removal template`). The same blocker class remains: 21
    monitored inputs are unmapped across the two sandbox templates, and
    fixed constants are still mostly unbound. Consequence: the sandbox
    validation pass keeps Gates D (credit-batch Removal POST +
    idempotency + stale-lock recovery) and E (GHG statement lifecycle)
    in `blocked-by-template-readiness` — Phases 1, 2 and the read paths
    are sandbox-verified, but the write paths cannot proceed until a
    sandbox template has both required-input coverage and pre-bound
    fixed constants.

### Phase 3 blockers found in template inspection

- **`isometric/phase-3-input-coverage`** — opened 2026-05-05
  - 20 monitored inputs on the demo project's default templates have no
    `INPUT_MAPPING` entry. Categories:
    - `distance` (km) — used by 4 transport components (biomass→processing,
      biochar→storage, sample→lab, staff travel). noma has per-leg `distance_km`
      on `transport_legs` (logistics.ts:174); aggregation needs to roll up
      transport-leg distances per credit-batch application — a new aggregation
      surface, not a production-run extension.
    - `final_readout` / `initial_readout` (kWh) — pyrolyzer electricity meter
      pre/post readings. noma stores `production_runs.electricityKwh` as a
      delta only; pre/post readouts are not captured. Either add columns or
      synthesize (`final = electricityKwh`, `initial = 0`).
    - `concentration` (mg/kg) + `mass_flow` (kg) — pyrolyzer GHG direct
      emissions (CH4, CO). noma has `credit_batches.ch4Ppm` /
      `ch4CompositionPercent` but at credit-batch level, not run level. Mapping
      shape mismatches (concentration is mg/kg, ppm is by mass at trace level).
  - Why it matters: every monitored input above is required by the demo
    template. Submitting the demo template's full graph requires either
    extending noma's schema/aggregation or asking the supplier to author a
    simpler removal template.
  - Resolve via product call: do we (a) author a noma-tailored removal
    template via Isometric's UI that uses only inputs noma has data for, or
    (b) extend noma to capture transport legs + electricity readouts + GHG
    concentrations? (a) is fastest; (b) is right long-term.

- **`isometric/phase-3-fixed-constants`** — opened 2026-05-05
  - The demo templates have ~12 `type=fixed` constants (carbon intensities,
    GWP, emission factors, specific volumes) without pre-bound datapoints.
    Phase 3's orchestrator bails with `SafeError` directing the admin to
    Isometric's template editor.
  - Why: constants are policy-level decisions (which emission factor to
    use for which fuel, which IPCC GWP value to use) — Isometric maintains
    these via supplier-managed Datapoints bound to the template, not
    noma-managed values. Phase 3 explicitly does not auto-create them.
  - Resolve via Isometric template setup: pre-bind a Datapoint per fixed
    input in the registry UI before the first credit-batch submission. This
    is one-time work per template, not per submission.

### Phase 4 deferrals

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

- **Source upload flow** (`isometric/phase-3.5`) — opened 2026-05-05
  - Implement the presigned-URL flow against whatever document-storage we
    land on. Until then, `certifierDocumentUploads` stays empty and
    `source_ids: []` on every Datapoint.
  - Why: Removals without Sources can be created in sandbox but verifiers
    will require source-of-truth attachments before Phase 4's GHG
    statement step.
  - Resolve once the noma documents subsystem has a real S3-equivalent
    backend (currently a mockup per `docs/forms.md`).

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

## (other areas added as they appear)
